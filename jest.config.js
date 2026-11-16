/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transform: {
    // Only report type errors from the test files themselves; engine sources are type-checked by tsc
    "^.+.ts?$": ["ts-jest", { tsconfig: "tsconfig.jest.json", diagnostics: { exclude: ["!**/*.test.ts"] } }],
    // three's examples/jsm helpers ship as ESM only
    "^.+[\\\\/]three[\\\\/]examples[\\\\/].+\\.js$": ["ts-jest", { tsconfig: "tsconfig.jest.json", diagnostics: false }],
  },
  transformIgnorePatterns: ['[\\\\/]node_modules[\\\\/](?!three[\\\\/]examples[\\\\/])'],
  testMatch: ['**/*.test.ts'],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  verbose: true
};