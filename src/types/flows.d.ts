declare module 'virtual:flows' {
  export const flows: Array<{
    /** bare filename without .json — what `?flow=` takes */
    id: string
    /** path relative to public/flows, e.g. "examples/oauth.json" */
    path: string
    /** the subdirectory it came from: "examples", "custom", or "" for the root */
    group: string
    title: string
    description: string
  }>
}
