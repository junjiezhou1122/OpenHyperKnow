import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm prose-neutral max-w-none [&_p]:my-1 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_code]:text-xs [&_code]:bg-black/[0.05] [&_code]:px-1 [&_code]:rounded [&_pre]:text-xs">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
