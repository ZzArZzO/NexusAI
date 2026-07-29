/** @type {import("prettier").Config} */
export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  arrowParens: 'always',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './packages/ui/src/styles/globals.css',
  overrides: [
    {
      files: '*.md',
      options: { printWidth: 80, proseWrap: 'preserve' },
    },
    {
      files: '*.prisma',
      options: { tabWidth: 2 },
    },
  ],
}
