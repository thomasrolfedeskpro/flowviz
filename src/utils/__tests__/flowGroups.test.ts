import { describe, it, expect } from 'vitest'
import {
  allGroupPaths,
  buildFlowTree,
  compareFlows,
  folderPath,
  groupSegments,
  knownGroups,
  normaliseGroup,
} from '@/utils/flowGroups'

const flow = (title: string, group?: string, source = 'custom') => ({ title, group, source })

describe('groupSegments', () => {
  it('splits a dotted path into one segment per folder', () => {
    expect(groupSegments('deskpro.infra.aws')).toEqual(['deskpro', 'infra', 'aws'])
  })

  it('takes a slash as a separator too', () => {
    expect(groupSegments('deskpro/infra')).toEqual(['deskpro', 'infra'])
  })

  it('ignores empty segments and surrounding space', () => {
    expect(groupSegments(' .deskpro. . infra .')).toEqual(['deskpro', 'infra'])
  })

  it('reads a missing group as no folders', () => {
    expect(groupSegments(undefined)).toEqual([])
  })
})

describe('normaliseGroup', () => {
  it('stores a slashed path the same way as a dotted one', () => {
    expect(normaliseGroup('deskpro/infra/aws')).toBe('deskpro.infra.aws')
  })

  it('turns a group of only separators into no group', () => {
    expect(normaliseGroup('. / .')).toBe('')
  })
})

describe('folderPath', () => {
  it('roots a bundled example in Examples', () => {
    expect(folderPath(flow('Coffee', undefined, 'examples'))).toEqual(['Examples'])
  })

  it('roots everything else in Custom', () => {
    expect(folderPath(flow('Ingest', 'deskpro.infra'))).toEqual(['Custom', 'deskpro', 'infra'])
  })

  it('treats a flow left at the root of public/flows as yours', () => {
    expect(folderPath(flow('Legacy', undefined, ''))).toEqual(['Custom'])
  })
})

describe('compareFlows', () => {
  it('puts bundled examples before everything else', () => {
    const sorted = [flow('Zebra', undefined, 'examples'), flow('Alpha', 'deskpro')]
      .sort(compareFlows)
      .map((f) => f.title)
    expect(sorted).toEqual(['Zebra', 'Alpha'])
  })

  it('sorts by title within one folder', () => {
    const sorted = [flow('Beta', 'deskpro'), flow('Alpha', 'deskpro')]
      .sort(compareFlows)
      .map((f) => f.title)
    expect(sorted).toEqual(['Alpha', 'Beta'])
  })
})

describe('buildFlowTree', () => {
  it('opens on just the two top-level folders', () => {
    const tree = buildFlowTree([
      flow('Coffee', undefined, 'examples'),
      flow('Ingest', 'deskpro.infra.aws'),
      flow('Loose'),
    ])
    expect(tree.map((n) => n.kind === 'group' && n.name)).toEqual(['Examples', 'Custom'])
  })

  it('nests one folder per segment of the group path, below Custom', () => {
    const [custom] = buildFlowTree([flow('Ingest', 'deskpro.infra.aws')])
    expect(custom).toMatchObject({ kind: 'group', name: 'Custom', path: 'Custom' })
    const deskpro = custom.kind === 'group' ? custom.children[0] : null
    expect(deskpro).toMatchObject({ kind: 'group', path: 'Custom.deskpro' })
    const infra = deskpro?.kind === 'group' ? deskpro.children[0] : null
    expect(infra).toMatchObject({ kind: 'group', path: 'Custom.deskpro.infra' })
    const aws = infra?.kind === 'group' ? infra.children[0] : null
    expect(aws).toMatchObject({ kind: 'group', name: 'aws', path: 'Custom.deskpro.infra.aws' })
  })

  it('counts every flow below a folder, not just the ones directly in it', () => {
    const [custom] = buildFlowTree([
      flow('Ingest', 'deskpro.infra'),
      flow('Export', 'deskpro.infra.aws'),
      flow('Overview', 'deskpro'),
    ])
    expect(custom.kind === 'group' && custom.count).toBe(3)
  })

  it('puts nested folders above the flows sitting directly in a folder', () => {
    const [custom] = buildFlowTree([flow('Loose'), flow('Ingest', 'deskpro')])
    const kinds = custom.kind === 'group' ? custom.children.map((c) => c.kind) : []
    expect(kinds).toEqual(['group', 'flow'])
  })

  it('files two flows with the same group under one folder', () => {
    const [custom] = buildFlowTree([flow('Ingest', 'deskpro'), flow('Export', 'deskpro')])
    const deskpro = custom.kind === 'group' ? custom.children[0] : null
    expect(deskpro?.kind === 'group' && deskpro.children).toHaveLength(2)
  })
})

describe('knownGroups', () => {
  it('offers every ancestor, so a flow can be filed part-way down', () => {
    expect(knownGroups([flow('Ingest', 'deskpro.infra.aws')])).toEqual([
      'deskpro',
      'deskpro.infra',
      'deskpro.infra.aws',
    ])
  })

  it('lists a shared folder once', () => {
    expect(knownGroups([flow('Ingest', 'deskpro.infra'), flow('Export', 'deskpro.cloud')])).toEqual([
      'deskpro',
      'deskpro.cloud',
      'deskpro.infra',
    ])
  })
})

describe('allGroupPaths', () => {
  it('walks the whole tree', () => {
    const tree = buildFlowTree([
      flow('Coffee', undefined, 'examples'),
      flow('Ingest', 'deskpro.infra'),
    ])
    expect(allGroupPaths(tree)).toEqual([
      'Examples',
      'Custom',
      'Custom.deskpro',
      'Custom.deskpro.infra',
    ])
  })
})
