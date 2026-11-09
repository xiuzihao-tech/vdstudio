// 给用户存一个文件：在 claude.ai 的页面里（在线演示）走页面的「下载」能力（会弹确认）；正常网页用普通下载链接。
type Downloads = { save: (r: { filename: string; data: Blob }) => Promise<{ status: string }> };

async function downloadsCap(): Promise<Downloads | null> {
  const c = (window as unknown as { claude?: { use?: (n: string) => Promise<unknown> } }).claude;
  if (!c?.use) return null;
  try { return await Promise.race([c.use('downloads') as Promise<Downloads | null>, new Promise<null>(r => setTimeout(() => r(null), 3000))]); } catch { return null; }
}

/** 存文件；返回 saved（存了）/ declined（用户取消）/ link（用的普通下载） */
export async function saveFile(filename: string, data: Blob): Promise<'saved' | 'declined' | 'link'> {
  const dl = await downloadsCap();
  if (dl) {
    try { await dl.save({ filename, data }); return 'saved'; }
    catch (e) { if ((e as { code?: string })?.code === 'declined') return 'declined'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(data); a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  return 'link';
}
