import unittest
from types import SimpleNamespace
from qwen_cached_suffix import embedding_kwargs


def array(*shape):
    return SimpleNamespace(shape=shape)


class CachedSuffixTest(unittest.TestCase):
    def test_cached_visual_prefix_does_not_reenter_suffix_embedding(self):
        positions=array(3,1,900)
        source={'mask':array(1,900),'image_grid_thw':array(1,3),
                'video_grid_thw':array(1,3),'video_second_per_grid':array(1),
                'position_ids':positions,'rope_deltas':array(1,1)}
        clean=embedding_kwargs(array(1,12),source)
        self.assertNotIn('mask',clean)
        self.assertNotIn('video_grid_thw',clean)
        self.assertNotIn('image_grid_thw',clean)
        self.assertIs(clean['position_ids'],positions)
        self.assertIn('mask',source)

    def test_cold_media_is_unchanged(self):
        source={'mask':array(1,900),'pixel_values_videos':array(6,100)}
        self.assertIs(embedding_kwargs(array(1,900),source),source)

    def test_missing_positions_or_new_media_cannot_be_silently_reused(self):
        for extra in ({},{'position_ids':array(3,1,900)},
                      {'position_ids':array(3,1,900),'rope_deltas':array(1,1),
                       'pixel_values_videos':array(6,100)}):
            with self.assertRaises(ValueError):
                embedding_kwargs(array(1,12),{'mask':array(1,900),**extra})


if __name__=='__main__':unittest.main()
