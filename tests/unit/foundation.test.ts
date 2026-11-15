import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { APP_NAME } from '@/shared/utils';

describe('Phase 0 Foundation Environment', () => {
  it('resolves @/ path alias to src/', () => {
    expect(APP_NAME).toBe('AuraStudy');
  });

  it('validates data schemas using zod', () => {
    const FoundationSchema = z.object({
      appName: z.string().min(1),
      phase: z.literal(0),
    });

    const parsed = FoundationSchema.parse({
      appName: APP_NAME,
      phase: 0,
    });

    expect(parsed).toEqual({
      appName: 'AuraStudy',
      phase: 0,
    });
  });
});
