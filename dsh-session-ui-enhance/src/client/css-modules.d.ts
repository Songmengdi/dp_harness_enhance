declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

// Plain global stylesheet: side-effect-only import, injected as one
// <style data-plugin> tag by the bundle; there are no class exports.
declare module '*.css'
