"""Compatibility entry point for existing official-diarize example callers."""

if __package__:
    from .diarize_audio import _result_to_dict, diarize_audio, main
else:
    from diarize_audio import _result_to_dict, diarize_audio, main


if __name__ == '__main__':
    raise SystemExit(main())
