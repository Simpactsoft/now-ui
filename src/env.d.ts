// Narrow ambient declaration for the one build-time flag the library reads.
//
// `process.env.NODE_ENV` is inlined by every bundler we target (Next/Turbopack,
// Vite, webpack), so this never reaches the browser as a real lookup. Declaring
// it here rather than depending on @types/node keeps Node's globals out of a
// package that only ever runs in the DOM.
declare const process: {
    env: {
        NODE_ENV?: string;
    };
};
