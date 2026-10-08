// Minimal stand-in for the `electron` module so main-process code can run under plain Node in tests.
export const app = {
    getPath: (_name: string) => process.env.TEST_USERDATA || process.cwd(),
};
