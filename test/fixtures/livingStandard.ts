import type { LivingStandardAssessment } from '../../src/features/opportunities/domain/livingStandard';

/** Synthetic illustration, not a real city's budget or research. */
export const livingStandardFixture: LivingStandardAssessment = {
  version: 1, housing_baseline: 'shared_flat', assessed_at: '2026-10-16', confidence: 'medium',
  summary: 'Illustrative assessment: a reasonable salary with a difficult room search.',
  salary_basis: 'Synthetic example: EUR 2,500 monthly take-home pay; no assumed bonuses.',
  budget_basis: 'Synthetic example: EUR 650 for a room in a shared flat plus EUR 700 for personal food, transport, insurance and a share of household utilities.',
  factors: {
    affordability: { score: 7.5, reason: 'A buffer remains after essential costs.' },
    housing: { score: 4, reason: 'Start the shared-flat room search before moving.' },
    culture: { score: 8, reason: 'Museums and live music within easy reach.' },
    nature: { score: 8, reason: 'Nearby parks and cycling routes.' },
    student_life: { score: 9, reason: 'An active university community.' },
    climate: { score: 6, reason: 'Mild temperatures; wet winters.' },
  },
  sources: [{ title: 'Synthetic example source', url: 'https://example.org/living-standard' }],
};
