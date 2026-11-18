import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', 'loadtest/**', 'delivery/**'] },
  ...tseslint.configs.recommended,
);
