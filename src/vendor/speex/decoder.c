/* SPDX-License-Identifier: GPL-3.0-or-later */
/* Small decoding-only interface around the unmodified BSD Speex codec. */
#include <stdlib.h>
#include <speex/speex.h>
#include <speex/speex_callbacks.h>
#include <speex/speex_stereo.h>

typedef struct {
  void *state;
  SpeexBits bits;
  SpeexStereoState *stereo;
  int frame_size;
  int channels;
} Decoder;

void *spx_alloc(int size) { return size > 0 && size <= 1048576 ? malloc((size_t)size) : NULL; }
void spx_free(void *value) { free(value); }

void spx_close(Decoder *decoder) {
  if (!decoder) return;
  if (decoder->state) speex_decoder_destroy(decoder->state);
  if (decoder->stereo) speex_stereo_state_destroy(decoder->stereo);
  speex_bits_destroy(&decoder->bits);
  free(decoder);
}

Decoder *spx_open(int mode_id, int channels, int sample_rate) {
  if (mode_id < 0 || mode_id > 2 || channels < 1 || channels > 2 || sample_rate < 4000 || sample_rate > 192000) return NULL;
  const SpeexMode *mode = speex_lib_get_mode(mode_id);
  Decoder *decoder = calloc(1, sizeof(Decoder));
  if (!decoder) return NULL;
  speex_bits_init(&decoder->bits);
  decoder->state = speex_decoder_init(mode);
  decoder->channels = channels;
  if (!decoder->state) { spx_close(decoder); return NULL; }
  speex_decoder_ctl(decoder->state, SPEEX_SET_SAMPLING_RATE, &sample_rate);
  speex_decoder_ctl(decoder->state, SPEEX_GET_FRAME_SIZE, &decoder->frame_size);
  if (channels == 2) {
    decoder->stereo = speex_stereo_state_init();
    if (!decoder->stereo) { spx_close(decoder); return NULL; }
    SpeexCallback callback = {0};
    callback.callback_id = SPEEX_INBAND_STEREO;
    callback.func = speex_std_stereo_request_handler;
    callback.data = decoder->stereo;
    speex_decoder_ctl(decoder->state, SPEEX_SET_HANDLER, &callback);
  }
  return decoder;
}

int spx_version(int mode_id) {
  if (mode_id < 0 || mode_id > 2) return -1;
  return speex_lib_get_mode(mode_id)->bitstream_version;
}
int spx_frame_size(Decoder *decoder) { return decoder ? decoder->frame_size : 0; }
int spx_lookahead(Decoder *decoder) {
  int value = 0;
  if (decoder) speex_decoder_ctl(decoder->state, SPEEX_GET_LOOKAHEAD, &value);
  return value;
}

/* Keep a packet's bit-reader between frames; calling a single-frame wrapper
   repeatedly would discard the following frames in an Ogg/Speex packet. */
int spx_packet(Decoder *decoder, char *packet, int length, short *pcm, int frames, int capacity) {
  if (!decoder || !packet || length <= 0 || length > 65536 || !pcm || frames < 1 || frames > 64) return -2;
  int expected = frames * decoder->frame_size * decoder->channels;
  if (capacity < expected) return -2;
  speex_bits_read_from(&decoder->bits, packet, length);
  int samples = 0;
  for (int i = 0; i < frames; i++) {
    short *output = pcm + samples * decoder->channels;
    int result = speex_decode_int(decoder->state, &decoder->bits, output);
    if (result == -1) break;
    if (result < 0 || speex_bits_remaining(&decoder->bits) < 0) return -2;
    if (decoder->channels == 2) speex_decode_stereo_int(output, decoder->frame_size, decoder->stereo);
    samples += decoder->frame_size;
  }
  return samples;
}
