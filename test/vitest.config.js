import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        globals: true,
        setupFiles: ['./setup/vitest.setup.js'],
        include: ['unit/**/*.spec.js'],
        coverage: {
            provider: 'v8',
            include: ['../utils/**/*.js', '../content/**/*.js'],
            reporter: ['text', 'html'],
        },
        server: {
            deps: {
                inline: ['jest-chrome'],
            },
        },
    },
});
