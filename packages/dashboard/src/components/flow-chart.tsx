import { Sankey, ResponsiveContainer, Tooltip } from 'recharts';
import type { SankeyGraph } from '@aiusage/shared';
import { formatCompact } from '../utils/format';
import { transformSankey } from '../utils/data';
import { EmptyState } from './chart-helpers';

function SankeyNodeLabel({
  x, y, width, height, payload,
}: {
  x: number; y: number; width: number; height: number;
  payload: { name: string };
}) {
  const isLeft = x < 200;
  return (
    <text
      x={isLeft ? x + width + 8 : x - 8}
      y={y + height / 2}
      textAnchor={isLeft ? 'start' : 'end'}
      dominantBaseline="central"
      className="fill-slate-600 dark:fill-slate-400 text-[11px]"
    >
      {payload.name}
    </text>
  );
}

export function FlowChart({ data }: { data?: SankeyGraph }) {
  const sankeyData = transformSankey(data);
  if (!sankeyData) return <EmptyState label="No flow data" />;
  const nodeCount = sankeyData.nodes.length;
  const height = Math.max(360, nodeCount * 40);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <Sankey
          data={sankeyData}
          nodePadding={28}
          nodeWidth={8}
          margin={{ left: 0, right: 0, top: 4, bottom: 4 }}
          link={{ stroke: '#94a3b8', strokeOpacity: 0.3, fill: 'none' }}
          node={<SankeyNodeLabel x={0} y={0} width={0} height={0} payload={{ name: '' }} />}
        >
          <Tooltip
            cursor={false}
            content={// eslint-disable-next-line @typescript-eslint/no-explicit-any
            (props: any) => {
              const pl = props.payload as Array<Record<string, unknown>> | undefined;
              if (!pl?.length) return null;
              const d = (pl[0]?.payload ?? pl[0]) as Record<string, unknown>;
              if (!d) return null;
              // Link hover: source/target are node objects with .name
              const srcNode = d.source as { name?: string } | undefined;
              const tgtNode = d.target as { name?: string } | undefined;
              // Node hover: just has .name
              const nodeName = (d as { name?: string }).name;
              const val = Number(d.value ?? 0);
              if (srcNode?.name && tgtNode?.name) {
                return (
                  <div className="rounded-lg border border-slate-200/90 bg-white/96 px-3 py-2 text-[12px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/96">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{srcNode.name} → {tgtNode.name}</div>
                    <div className="mt-0.5 tabular-nums text-slate-500 dark:text-slate-400">{formatCompact(val)} tokens</div>
                  </div>
                );
              }
              if (nodeName) {
                return (
                  <div className="rounded-lg border border-slate-200/90 bg-white/96 px-3 py-2 text-[12px] shadow-lg backdrop-blur dark:border-slate-700 dark:bg-slate-800/96">
                    <div className="font-medium text-slate-700 dark:text-slate-200">{nodeName}</div>
                    {val > 0 && <div className="mt-0.5 tabular-nums text-slate-500 dark:text-slate-400">{formatCompact(val)} tokens</div>}
                  </div>
                );
              }
              return null;
            }}
          />
        </Sankey>
      </ResponsiveContainer>
    </div>
  );
}
