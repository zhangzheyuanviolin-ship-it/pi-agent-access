"""Keep full-prompt RoPE metadata separate from a cached text suffix.

MLX-VLM primes position_ids/rope_deltas before trimming input_ids. Its Omni
embedding helper still receives the full mask and visual grids. Those describe
the retained prefix, not new media to scatter into the suffix.
"""

def embedding_kwargs(input_ids, kwargs):
    mask = kwargs.get('mask')
    if mask is None or mask.shape[-1] == input_ids.shape[-1]:
        return kwargs
    positions = kwargs.get('position_ids')
    if (positions is None or positions.shape[-1] != mask.shape[-1]
            or kwargs.get('rope_deltas') is None
            or mask.shape[-1] <= input_ids.shape[-1]):
        raise ValueError('Cached Omni suffix is missing full-prompt RoPE metadata')
    if any(kwargs.get(key) is not None for key in (
            'pixel_values', 'pixel_values_videos', 'input_features')):
        raise ValueError('Cached Omni suffix unexpectedly contains new media')
    clean = dict(kwargs)
    for key in ('mask', 'image_grid_thw', 'video_grid_thw',
                'video_second_per_grid', 'feature_attention_mask',
                'audio_feature_lengths'):
        clean.pop(key, None)
    return clean
