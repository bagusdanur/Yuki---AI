import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'

export default function MarkdownView({ children }: { children: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          a: ({ href, children: linkChildren, ...props }) => (
            <a {...props} href={href} target="_blank" rel="noopener noreferrer">{linkChildren}</a>
          ),
          code: ({ className, children: codeChildren, ...props }) => {
            const value = String(codeChildren || '').replace(/\n$/, '')
            const block = Boolean(className) || value.includes('\n')
            return block ? (
              <span className="code-block-wrap">
                <button type="button" onClick={() => navigator.clipboard.writeText(value)}>Salin</button>
                <code {...props} className={className}>{value}</code>
              </span>
            ) : (
              <code {...props} className={className}>{codeChildren}</code>
            )
          }
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
