"""Use upstream Transformers' exact Omni mRoPE on CPU; all weights/inference stay MLX.
This request-local adapter does not alter prompts, sampling, weights or KV caches.
It fixes visual/audio boundary positions missing from the MLX 0.7.11 port.
"""
from pathlib import Path
from types import MethodType,SimpleNamespace
from dataclasses import replace
import numpy as np
import mlx.core as mx
import torch
from transformers import Qwen3OmniMoeConfig
from transformers.models.qwen3_omni_moe.modeling_qwen3_omni_moe import Qwen3OmniMoePreTrainedModelForConditionalGeneration as Official

def install(model,model_path):
    torch.set_num_threads(1)
    config=Qwen3OmniMoeConfig.from_pretrained(str(model_path),local_files_only=True).thinker_config
    ref=SimpleNamespace(config=config,spatial_merge_size=config.vision_config.spatial_merge_size)
    ref.get_llm_pos_ids_for_vision=MethodType(Official.get_llm_pos_ids_for_vision,ref)
    ref.get_chunked_index=MethodType(Official.get_chunked_index,ref)
    original=model.thinker.get_input_embeddings
    def tensor(v,dtype=torch.long):
        return None if v is None else torch.as_tensor(np.asarray(v).copy(),dtype=dtype,device='cpu')
    def wrapped(self,*args,**kwargs):
        ids=kwargs.get('input_ids',args[0]if args else None)
        if ids is not None:
            from qwen_cached_suffix import embedding_kwargs
            kwargs=embedding_kwargs(ids,kwargs)
        result=original(*args,**kwargs)
        if ids is None:return result
        image_grid=kwargs.get('image_grid_thw');video_grid=kwargs.get('video_grid_thw');features=kwargs.get('input_features');audio_lengths=None
        if features is None or (image_grid is None and video_grid is None):return result
        if features is not None:
            mask=kwargs.get('feature_attention_mask');mel_frames=features.shape[-1]
            if mask is None:audio_lengths=torch.tensor([mel_frames],dtype=torch.long)
            else:
                lengths=np.asarray(mask).sum(-1)
                if mask.shape[-1]>mel_frames:lengths=lengths//(mask.shape[-1]//mel_frames)
                audio_lengths=torch.tensor(lengths.copy(),dtype=torch.long)
        id_array=np.asarray(ids)
        # HF's video-audio template starts a vision segment with audio_start.
        interleaved=bool(np.any((id_array[:,:-1]==config.vision_start_token_id)&(id_array[:,1:]==config.audio_start_token_id)))
        seconds=kwargs.get('video_second_per_grid')
        if video_grid is not None and seconds is None:raise ValueError('Video timing metadata missing; refusing silent temporal fallback')
        pos,delta=Official.get_rope_index(ref,input_ids=tensor(ids),image_grid_thw=tensor(image_grid),video_grid_thw=tensor(video_grid),attention_mask=tensor(kwargs.get('mask')) if kwargs.get('mask') is not None else torch.ones(ids.shape,dtype=torch.long),use_audio_in_video=interleaved,audio_seqlens=audio_lengths,second_per_grids=tensor(seconds,torch.float32))
        assert tuple(pos.shape)==(3,ids.shape[0],ids.shape[1])
        if image_grid is None and video_grid is None:pos=pos[0]
        return replace(result,position_ids=mx.array(pos.numpy(),dtype=mx.int32),rope_deltas=mx.array(delta.numpy(),dtype=mx.int32))
    model.thinker.get_input_embeddings=MethodType(wrapped,model.thinker)
    return {'reference':'transformers Qwen3OmniMoePreTrainedModelForConditionalGeneration.get_rope_index','reference_file':str(Path(__import__('inspect').getfile(Official))),'torch_device':'cpu','weights_and_decode':'MLX checkpoint dtype','no_prompt_mutation':True}
