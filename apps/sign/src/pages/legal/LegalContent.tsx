import { Fragment, ReactNode } from 'react';
import type { LegalBlock, LegalSection } from './content/_types';

function renderBlock(block: LegalBlock, key: number): ReactNode {
  if (block.type === 'p') {
    return (
      <p key={key} className="my-3 text-gray-700">
        {block.text}
      </p>
    );
  }
  if (block.type === 'h3') {
    return (
      <h4 key={key} className="mt-5 mb-2 text-base font-semibold text-[#0F1729]">
        {block.text}
      </h4>
    );
  }
  if (block.type === 'list') {
    return (
      <ul key={key} className="my-3 list-disc space-y-1 pl-6 text-gray-700">
        {block.items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    );
  }
  if (block.type === 'table') {
    return (
      <div key={key} className="my-4 overflow-x-auto">
        <table className="min-w-full border-collapse text-sm">
          <tbody>
            {block.rows.map((row, ri) => (
              <tr key={ri} className={ri === 0 ? 'bg-gray-50 font-semibold text-[#0F1729]' : 'border-t border-gray-200'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="border border-gray-200 px-3 py-2 align-top text-gray-700">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return null;
}

interface LegalContentProps {
  sections: LegalSection[];
  beforeFirstSection?: ReactNode;
}

export default function LegalContent({ sections, beforeFirstSection }: LegalContentProps) {
  return (
    <article className="max-w-none">
      {beforeFirstSection}
      {sections.map((sec) => (
        <section key={sec.id} id={sec.id} className="scroll-mt-24 pb-6 pt-2">
          <h2 className="mt-2 text-xl font-bold text-[#0F1729] sm:text-2xl">{sec.title}</h2>
          {sec.intro.map((b, i) => (
            <Fragment key={`i-${i}`}>{renderBlock(b, i)}</Fragment>
          ))}
          {sec.subsections.map((sub) => (
            <section key={sub.id} id={sub.id} className="mt-4 scroll-mt-24">
              <h3 className="mt-3 text-lg font-semibold text-[#0F1729]">{sub.title}</h3>
              {sub.blocks.map((b, i) => (
                <Fragment key={`b-${i}`}>{renderBlock(b, i)}</Fragment>
              ))}
            </section>
          ))}
        </section>
      ))}
    </article>
  );
}
