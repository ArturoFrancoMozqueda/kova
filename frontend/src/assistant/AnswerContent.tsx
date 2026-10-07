import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Model text is untrusted. Keep navigation in server-provided source cards:
// no HTML, remote images, or model-authored links are made interactive.
export default function AnswerContent({ content }: { content: string }) {
  return <div className="min-w-0 break-words text-sm leading-7 text-kova-ink [&>p]:mb-3 [&>p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_li::marker]:text-kova-blue [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-kova-blue [&_blockquote]:pl-4 [&_blockquote]:text-kova-muted [&_code]:rounded [&_code]:bg-kova-mist [&_code]:px-1 [&_code]:text-xs [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-kova-md [&_pre]:bg-kova-mist [&_pre]:p-3 [&_hr]:my-4 [&_hr]:border-kova-border [&_th]:border-b [&_th]:border-kova-border [&_th]:bg-kova-mist [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_td]:border-b [&_td]:border-kova-border [&_td]:px-3 [&_td]:py-2">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img", "input"]} components={{
      h1: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h3>,
      h2: ({ children }) => <h3 className="mb-2 mt-5 text-base font-semibold first:mt-0">{children}</h3>,
      h3: ({ children }) => <h3 className="mb-2 mt-4 text-sm font-semibold first:mt-0">{children}</h3>,
      a: ({ children }) => <span>{children}</span>,
      table: ({ children }) => <div className="my-4 max-w-full overflow-x-auto rounded-kova-md border border-kova-border"><table className="w-full text-sm">{children}</table></div>,
    }}>{content}</Markdown>
  </div>;
}
