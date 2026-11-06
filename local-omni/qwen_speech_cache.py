"""Cache the native Qwen speech Thinker without a second language-model pass.

Adapted from MLX-VLM 0.7.11's Qwen3 Omni helper (MIT), retaining its sampler,
Talker hidden layer and token sequence. Cache reuse requires the same retained
media bytes, a matching token prefix and trimmable KV layers. Nothing is written
to the installed MLX-VLM package or shared with another model.
Source: https://github.com/Blaizzy/mlx-vlm/blob/v0.7.11/mlx_vlm/models/qwen3_omni_moe/qwen3_omni_moe.py
"""
from typing import Optional
import mlx.core as mx
from mlx_vlm.models import cache as kv_cache
from mlx_vlm.sample_utils import make_logits_processors, make_sampler

def cached_thinker(
    self,
    input_ids: mx.array,
    *,
    target_layer_idx: int,
    thinker_max_new_tokens: int,
    thinker_eos_token_id: int,
    temperature: float = 0.0,
    top_p: float = 1.0,
    min_p: float = 0.0,
    top_k: int = 0,
    logit_bias: Optional[dict[int, float]] = None,
    repetition_penalty: Optional[float] = None,
    repetition_context_size: Optional[int] = 20,
    presence_penalty: Optional[float] = None,
    presence_context_size: Optional[int] = 20,
    frequency_penalty: Optional[float] = None,
    frequency_context_size: Optional[int] = 20,
    **kwargs,
):
    """Generate Thinker tokens while retaining the Talker accept-layer hidden.

    The audio-output path needs both the final Thinker token sequence and the
    hidden states from ``accept_hidden_layer``.  The previous implementation
    generated tokens first and then ran a second full forward pass over the
    completed sequence to recover those hidden states.  This helper captures
    the same layer during prefill/decode and avoids that second pass.
    """
    embed_kwargs = {
        k: v
        for k, v in kwargs.items()
        if k
        in [
            "pixel_values",
            "pixel_values_videos",
            "image_grid_thw",
            "video_grid_thw",
            "video_second_per_grid",
            "input_features",
            "feature_attention_mask",
            "audio_feature_lengths",
        ]
    }
    input_embedding_features = self.thinker.get_input_embeddings(
        input_ids, **embed_kwargs
    )
    inputs_embeds = input_embedding_features.inputs_embeds

    lm_kwargs = {
        k: v
        for k, v in input_embedding_features.to_dict().items()
        if k != "inputs_embeds" and v is not None
    }
    lm_kwargs.update(
        {
            k: v
            for k, v in kwargs.items()
            if k in ["image_grid_thw", "video_grid_thw"]
        }
    )
    decode_lm_kwargs = dict(lm_kwargs)
    decode_lm_kwargs.pop("position_ids", None)

    owner = self._pia_speech_owner
    state = owner.speech_cache
    token_ids = input_ids.flatten().tolist()
    prefix = 0
    if state and owner.speech_media_compatible:
        for old,new in zip(state['ids'],token_ids):
            if old!=new:break
            prefix+=1
        prefix=min(prefix,len(token_ids)-1)
        if prefix and all(c.is_trimmable() for c in state['cache']):
            for c in state['cache']:
                c.trim(max(0,int(c.offset)-prefix))
            prompt_cache=state['cache']
        else:prefix=0
    if not prefix:prompt_cache=kv_cache.make_prompt_cache(self.thinker.language_model)
    full_embeds=inputs_embeds
    inputs_embeds=inputs_embeds[:,prefix:]
    prompt_ids=input_ids[:,prefix:]
    owner.speech_usage={'prompt_tokens':len(token_ids),'prompt_tokens_details':{'cached_tokens':prefix}}
    # Drop the mutable owner immediately; only a completely generated task commits.
    owner.speech_cache=None
    if owner.speech_cancel is not None and owner.speech_cancel.is_set():
        raise InterruptedError('Speech cancelled before prefill')
    outputs = self.thinker.language_model(
        prompt_ids,
        inputs_embeds=inputs_embeds,
        cache=prompt_cache,
        output_hidden_state_idx=target_layer_idx + 1,
        **lm_kwargs,
    )
    hidden_states = ([state['hidden'][:,:prefix]] if prefix else [])+[outputs.hidden_states]
    sequences = [input_ids]

    logits = outputs.logits[:, -1, :]
    sampler = make_sampler(
        temp=temperature,
        top_p=top_p,
        min_p=min_p,
        top_k=top_k,
    )
    processors = make_logits_processors(
        logit_bias,
        repetition_penalty,
        repetition_context_size,
        presence_penalty,
        presence_context_size,
        frequency_penalty,
        frequency_context_size,
    )
    processed_tokens = mx.array([], dtype=input_ids.dtype)

    def _sample_next(logits, step_tokens):
        nonlocal processed_tokens
        if processors:
            processed_tokens = mx.concat([processed_tokens, step_tokens.flatten()])
            for processor in processors:
                logits = processor(processed_tokens, logits)
        return sampler(logits)

    token = _sample_next(logits, input_ids)
    if token.ndim == 2:
        token = token[:, 0]

    for _ in range(thinker_max_new_tokens):
        if owner.speech_cancel is not None and owner.speech_cancel.is_set():
            raise InterruptedError('Speech cancelled during decode')
        token_id = int(token.item())
        sequences.append(token[:, None].astype(input_ids.dtype))

        step_outputs = self.thinker.language_model(
            token[:, None],
            cache=prompt_cache,
            output_hidden_state_idx=target_layer_idx + 1,
            **decode_lm_kwargs,
        )
        hidden_states.append(step_outputs.hidden_states)
        if token_id == thinker_eos_token_id:
            break

        logits = step_outputs.logits[:, -1, :]
        token = _sample_next(logits, token[:, None])
        if token.ndim == 2:
            token = token[:, 0]

    inputs_embeds=full_embeds
    if len(sequences) > 1:
        generated_ids = mx.concatenate(sequences[1:], axis=1)
        generated_embeds = self.thinker.language_model.model.embed_tokens(
            generated_ids
        )
        inputs_embeds = mx.concatenate([inputs_embeds, generated_embeds], axis=1)

    sequence=mx.concatenate(sequences,axis=1)
    hidden=mx.concatenate(hidden_states,axis=1)
    mx.eval(sequence,hidden,inputs_embeds)
    owner.speech_cache={'ids':sequence.flatten().tolist(),'hidden':hidden,'cache':prompt_cache}
    owner.speech_usage['completion_tokens']=sequence.shape[-1]-input_ids.shape[-1]
    return sequence,hidden,inputs_embeds
