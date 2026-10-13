/**
 * JSON-LD 数据块。
 *
 * 这里的 <script> 的 type 不是 JS MIME，它是**数据块**而不是脚本，不会被浏览器执行，
 * 因此也不受 `script-src` 约束、不需要 nonce：已用严格 CSP（`script-src 'nonce-…'
 * 'strict-dynamic'`）实测过，页面没有触发 securitypolicyviolation，元素也照常可读。
 * 反过来，给它加 nonce 会让 CSP 的 nonce 值进入页面内容，多一份不该有的泄漏面。
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Array<Record<string, unknown>> }) {
  return (
    <script
      type="application/ld+json"
      // 数据里若出现 `</script>` 会把标签提前关掉，所以把 `<` 转成 \u003c（JSON 里等价）。
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
