declare module 'virtual:flows' {
  export const flows: Array<{
    /** bare filename without .json — what `?flow=` takes */
    id: string
    /** path relative to public/flows, e.g. "examples/oauth.json" */
    path: string
    /** the directory it came from: "examples", "custom", or "" for the root.
     *  Picks the top-level folder, and decides what may be deleted — the dev
     *  server refuses examples. */
    source: string
    /** dot-separated path below that folder, e.g. "deskpro.infra.aws", from
     *  `meta.group`. Empty means the flow sits directly in it. */
    group: string
    title: string
    description: string
  }>
}
