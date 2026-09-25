# Produced audio masters

Recorded voice and soundscapes for Handoff 10 1E (package 11) go here as WAV
masters, once they exist under founder action F4 (rights and licensing).

Every file here is checked in CI by `scripts/check-audio-mono.ts`. A file fails if:

- it is not a readable WAV (PCM 8/16/24/32-bit or 32/64-bit float);
- it has more than two channels;
- its left and right channels correlate below 0.99, over the whole file or in any
  one-second stretch that carries sound;
- its two channels differ in level by more than 1 dB.

The rule is v1's: no bilateral stimulation by any route, and audio that moves
between the ears is bilateral stimulation. Mono is simplest.

Name each file with its `script_id` and `script_version` (Handoff 10 1E). Encoded
copies for delivery are made from a checked master and do not live here.
