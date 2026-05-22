/**
 * Re-exports from the engine layer.
 * The implementation has been moved to engine/evaluateUserResponse.ts.
 * This shim preserves backward compatibility for all existing callers.
 */
export {
  evaluateUserResponse,
  type EvaluationInput,
  type EvaluationResult,
} from './engine/evaluateUserResponse';
