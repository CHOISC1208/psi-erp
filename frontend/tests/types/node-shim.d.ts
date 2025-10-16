declare module "node:test" {
  type TestFn = (name: string, fn: () => void | Promise<void>) => void;
  const test: TestFn;
  export default test;
  export { test };
}

declare module "node:assert/strict" {
  const assert: {
    (value: unknown, message?: string): void;
    equal: (actual: unknown, expected: unknown, message?: string) => void;
    deepEqual: (actual: unknown, expected: unknown, message?: string) => void;
    ok: (value: unknown, message?: string) => void;
  };
  export default assert;
}
