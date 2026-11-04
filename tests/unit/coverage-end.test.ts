// @vitest-environment node
import { analyzedUpTo } from '../../src/lib/pipeline';

type Span = { pages: [number, number] };

describe('analyzedUpTo', () => {
  it('is the last page of the sent chunks when the next chunk starts after it', () => {
    const chunks: Span[] = [{ pages: [1, 10] }, { pages: [11, 20] }, { pages: [21, 30] }];
    expect(analyzedUpTo(chunks, 2)).toBe(20);
  });

  it('stops before an unsent chunk that starts inside the sent range', () => {
    // A text chunk 1-125 with a scan page 110 split off into a chunk that was cut by the cap.
    const chunks: Span[] = [{ pages: [1, 125] }, { pages: [110, 110] }];
    expect(analyzedUpTo(chunks, 1)).toBe(109);
  });
});
