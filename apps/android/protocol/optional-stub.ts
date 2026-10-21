/**
 * Stand-in for ts-mls's optional packages (HPKE ChaCha20/X448/ML-KEM/X-Wing, ML-DSA signatures), which Convo's
 * cipher suite does not use. Inlined into the IIFE bundle, a missing optional import would become
 * a top-level `throw`; with this empty module ts-mls reports its own "optional dependency not
 * installed" error only if such a suite were ever requested.
 */
export {};
