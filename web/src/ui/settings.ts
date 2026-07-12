/**
 * ui/settings.ts — 「配置模型」面板（嵌入设置中心弹窗 ui/settingshub.ts）。
 * 分区：总开关 / 嵌入模型（本地·云端）/ 问答模型 / 检索参数 / 评估与反馈（带目标仓库下拉）。
 * apiKey 全程掩码往返；「测试连接」直连 /api/rag/test。
 */
import {
  fetchWorld,
  ragEvalFromFeedback,
  ragEvalRun,
  ragFeedbackStats,
  ragGetConfig,
  ragSaveConfig,
  ragTest,
} from '../api';
import type { RagConfig } from '@shared/types';
import { createDropdown } from './dropdown';
import { ICON } from './icons';

export interface ModelPane {
  /** 重新拉取配置与仓库列表（面板每次展示时调用） */
  refresh(): void;
  /** 保存成功后的回调 */
  onSaved?: (cfg: RagConfig) => void;
  dispose(): void;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string,
  );
}

function endpointFields(prefix: string, withKey: boolean): string {
  return (
    `<label class="st-field">baseUrl<input data-k="${prefix}.baseUrl" spellcheck="false" /></label>` +
    (withKey
      ? `<label class="st-field">apiKey<input data-k="${prefix}.apiKey" type="password" spellcheck="false" placeholder="sk-…" /></label>`
      : '') +
    `<label class="st-field">模型<input data-k="${prefix}.model" spellcheck="false" /></label>`
  );
}

export function createModelPane(mount: HTMLElement): ModelPane {
  mount.innerHTML = `
    <section class="st-section">
      <label class="st-switch"><input type="checkbox" data-k="enabled" />
        <b>启用向量检索</b><span class="st-hint">关闭时 ⌘K 搜索与地图行为与原版完全一致</span></label>
    </section>

    <section class="st-section">
      <h4>嵌入模型 <span class="st-hint">切片向量化所用；本地/云端均为 OpenAI 兼容协议</span></h4>
      <div class="st-modes" data-group="embedding">
        <label><input type="radio" name="emb-mode" value="local" /> 本地（Ollama 千问）</label>
        <label><input type="radio" name="emb-mode" value="remote" /> 云端（DashScope 千问）</label>
      </div>
      <div class="st-ep" data-ep="embedding.local">${endpointFields('embedding.local', false)}</div>
      <div class="st-ep" data-ep="embedding.remote">${endpointFields('embedding.remote', true)}</div>
      <div class="st-testrow"><button class="st-test" data-target="embedding">测试连接</button><span class="st-testout" data-out="embedding"></span></div>
    </section>

    <section class="st-section">
      <h4>问答模型 <span class="st-hint">可选；开启后 ⌘K 中出现「问答」，答案强制带引用</span></h4>
      <div class="st-modes" data-group="chat">
        <label><input type="radio" name="chat-mode" value="off" /> 关闭</label>
        <label><input type="radio" name="chat-mode" value="local" /> 本地</label>
        <label><input type="radio" name="chat-mode" value="remote" /> 云端</label>
      </div>
      <div class="st-ep" data-ep="chat.local">${endpointFields('chat.local', false)}</div>
      <div class="st-ep" data-ep="chat.remote">${endpointFields('chat.remote', true)}</div>
      <div class="st-testrow"><button class="st-test" data-target="chat">测试连接</button><span class="st-testout" data-out="chat"></span></div>
    </section>

    <section class="st-section">
      <h4>检索参数</h4>
      <div class="st-params">
        <label class="st-field">topK<input data-k="retrieval.topK" type="number" min="1" max="50" /></label>
        <label class="st-field">相似度阈值<input data-k="retrieval.minScore" type="number" min="0" max="1" step="0.05" /></label>
        <label class="st-field">单文档上限<input data-k="retrieval.perDocLimit" type="number" min="1" max="20" /></label>
        <label class="st-field">上下文预算(字符)<input data-k="retrieval.maxContextChars" type="number" min="500" step="500" /></label>
      </div>
      <label class="st-switch"><input type="checkbox" data-k="retrieval.hybrid" />
        混合检索<span class="st-hint">关键词精确召回 + 向量语义召回，RRF 融合重排</span></label>
    </section>

    <section class="st-section st-evalsec">
      <h4>评估与反馈 <span class="st-hint">生产可诊断：召回/重排/生成/引用四层指标</span></h4>
      <label class="st-field st-evalvault">目标仓库<div class="st-eval-vault"></div></label>
      <div class="st-fbstats">加载中…</div>
      <div class="st-testrow">
        <button class="st-runeval">运行评估</button>
        <button class="st-fb2eval">差评导入评估集</button>
      </div>
      <div class="st-evalout"></div>
    </section>

    <div class="st-actions">
      <span class="note-status st-status"></span>
      <button class="note-save st-save">保存</button>
    </div>`;

  const statusEl = mount.querySelector<HTMLElement>('.st-status')!;
  const fbStatsEl = mount.querySelector<HTMLElement>('.st-fbstats')!;
  const evalOutEl = mount.querySelector<HTMLElement>('.st-evalout')!;
  const evalVaultDd = createDropdown(mount.querySelector<HTMLElement>('.st-eval-vault')!);
  const saveBtn = mount.querySelector<HTMLButtonElement>('.st-save')!;

  let cfg: RagConfig | null = null;
  let curVault: string | null = null;
  let saveBtnTimer: ReturnType<typeof setTimeout> | null = null;

  // ---- cfg ↔ DOM 双向映射（data-k 为点路径） ----

  function getByPath(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
  }
  function setByPath(obj: unknown, path: string, value: unknown): void {
    const keys = path.split('.');
    const last = keys.pop()!;
    const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
    if (target && typeof target === 'object') (target as Record<string, unknown>)[last] = value;
  }

  function fillForm(): void {
    if (!cfg) return;
    for (const input of mount.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const v = getByPath(cfg, input.dataset.k!);
      if (input.type === 'checkbox') input.checked = Boolean(v);
      else input.value = v == null ? '' : String(v);
    }
    for (const r of mount.querySelectorAll<HTMLInputElement>('input[name="emb-mode"]')) {
      r.checked = r.value === cfg.embedding.mode;
    }
    for (const r of mount.querySelectorAll<HTMLInputElement>('input[name="chat-mode"]')) {
      r.checked = r.value === cfg.chat.mode;
    }
    syncEpVisibility();
  }

  function readForm(): void {
    if (!cfg) return;
    for (const input of mount.querySelectorAll<HTMLInputElement>('input[data-k]')) {
      const k = input.dataset.k!;
      if (input.type === 'checkbox') setByPath(cfg, k, input.checked);
      else if (input.type === 'number') setByPath(cfg, k, Number(input.value));
      else setByPath(cfg, k, input.value.trim());
    }
    cfg.embedding.mode =
      (mount.querySelector<HTMLInputElement>('input[name="emb-mode"]:checked')?.value as
        | 'local'
        | 'remote') ?? cfg.embedding.mode;
    cfg.chat.mode =
      (mount.querySelector<HTMLInputElement>('input[name="chat-mode"]:checked')?.value as
        | 'off'
        | 'local'
        | 'remote') ?? cfg.chat.mode;
  }

  /** 只显示当前 mode 对应的端点字段组 */
  function syncEpVisibility(): void {
    const emb = mount.querySelector<HTMLInputElement>('input[name="emb-mode"]:checked')?.value ?? 'local';
    const chat = mount.querySelector<HTMLInputElement>('input[name="chat-mode"]:checked')?.value ?? 'off';
    for (const ep of mount.querySelectorAll<HTMLElement>('.st-ep')) {
      const key = ep.dataset.ep!;
      const show =
        (key.startsWith('embedding.') && key.endsWith(emb)) ||
        (key.startsWith('chat.') && chat !== 'off' && key.endsWith(chat));
      ep.style.display = show ? 'grid' : 'none';
    }
  }

  function setStatus(text: string, cls: '' | 'ok' | 'err' | 'loading' = ''): void {
    statusEl.textContent = text;
    statusEl.className = `note-status st-status ${cls}`;
  }

  // ---- 行为 ----

  async function load(): Promise<void> {
    setStatus('加载配置…', 'loading');
    try {
      cfg = await ragGetConfig();
      fillForm();
      setStatus('');
    } catch (e) {
      setStatus(`配置加载失败：${(e as Error).message}`, 'err');
    }
  }

  async function save(): Promise<void> {
    if (!cfg) return;
    readForm();
    if (saveBtnTimer !== null) clearTimeout(saveBtnTimer);
    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';
    saveBtn.classList.remove('saved');
    setStatus(''); // 成功反馈只由按钮承载，状态行仅用于错误
    try {
      cfg = await ragSaveConfig(cfg);
      fillForm();
      saveBtn.textContent = '已保存 ✓';
      saveBtn.classList.add('saved');
      api.onSaved?.(cfg);
    } catch (e) {
      setStatus(`保存失败：${(e as Error).message}`, 'err');
      saveBtn.textContent = '保存';
    } finally {
      saveBtn.disabled = false;
      // 短暂展示成功态后恢复按钮文案
      saveBtnTimer = setTimeout(() => {
        saveBtn.textContent = '保存';
        saveBtn.classList.remove('saved');
      }, 1800);
    }
  }

  async function runTest(target: 'embedding' | 'chat', out: HTMLElement): Promise<void> {
    // 先保存再测：测试端点读的是落盘配置
    readForm();
    if (cfg) {
      try {
        cfg = await ragSaveConfig(cfg);
        fillForm();
      } catch (e) {
        out.textContent = `保存失败：${(e as Error).message}`;
        out.className = 'st-testout err';
        return;
      }
    }
    out.textContent = '测试中…';
    out.className = 'st-testout';
    try {
      const r = await ragTest(target);
      if (r.ok) {
        out.textContent = target === 'embedding' ? `✓ 连通，维度 ${r.dims}` : `✓ 连通`;
        out.className = 'st-testout ok';
      } else {
        out.textContent = `✗ ${r.error ?? '连接失败'}`;
        out.className = 'st-testout err';
      }
    } catch (e) {
      out.textContent = `✗ ${(e as Error).message}`;
      out.className = 'st-testout err';
    }
  }

  /** 填充评估目标仓库下拉；无仓库时禁用评估区 */
  async function populateEvalVaults(): Promise<void> {
    let vaults: { id: string; name: string }[] = [];
    try {
      const w = await fetchWorld();
      if (Array.isArray(w.vaults)) vaults = w.vaults;
    } catch {
      /* 列表不可用时按空处理 */
    }
    if (vaults.length === 0) {
      evalVaultDd.setOptions([{ value: '', label: '（尚无仓库）' }], '');
      curVault = null;
      fbStatsEl.textContent = '添加仓库后可用';
      return;
    }
    if (!curVault || !vaults.some((v) => v.id === curVault)) curVault = vaults[0].id;
    evalVaultDd.setOptions(
      vaults.map((v) => ({ value: v.id, label: v.name })),
      curVault,
    );
    void loadFeedbackStats();
  }

  async function loadFeedbackStats(): Promise<void> {
    if (!curVault) return;
    try {
      const s = await ragFeedbackStats(curVault);
      const down = s.recentDown
        .slice(0, 3)
        .map((d) => `「${esc(d.question)}」`)
        .join(' ');
      fbStatsEl.innerHTML =
        `反馈共 ${s.total} 条 · ${ICON.thumbUp} ${s.byKind.up} · ${ICON.thumbDown} ${s.byKind.down} · 追问 ${s.byKind.followup}` +
        (down ? `<div class="st-hint">最近差评：${down}</div>` : '');
    } catch {
      fbStatsEl.textContent = '反馈统计不可用';
    }
  }

  async function runEvalUI(): Promise<void> {
    if (!curVault) return;
    evalOutEl.textContent = '评估运行中…';
    try {
      const r = await ragEvalRun(curVault);
      const pct = (x: number | null): string => (x === null ? '—' : `${Math.round(x * 100)}%`);
      evalOutEl.innerHTML =
        `<table class="st-evaltable">` +
        `<tr><td>召回 recall@k</td><td>${pct(r.recallAtK)}</td><td>重排 MRR</td><td>${r.mrr.toFixed(3)}</td></tr>` +
        `<tr><td>生成正确率</td><td>${pct(r.answerOkRate)}</td><td>引用精度</td><td>${pct(r.citationPrecision)}</td></tr>` +
        `</table>` +
        `<div class="st-hint">有效用例 ${r.caseCount} · 待标注草稿 ${r.draftCount}（编辑 ~/.notopolis/rag/&lt;vault&gt;/eval.json 补 relevantDocs）</div>`;
    } catch (e) {
      evalOutEl.textContent = `评估失败：${(e as Error).message}`;
    }
  }

  saveBtn.addEventListener('click', () => void save());
  mount.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.name === 'emb-mode' || t.name === 'chat-mode') syncEpVisibility();
  });
  evalVaultDd.onChange = (v) => {
    curVault = v || null;
    evalOutEl.textContent = '';
    void loadFeedbackStats();
  };
  for (const btn of mount.querySelectorAll<HTMLButtonElement>('.st-test')) {
    btn.addEventListener('click', () => {
      const target = btn.dataset.target as 'embedding' | 'chat';
      const out = mount.querySelector<HTMLElement>(`[data-out="${target}"]`)!;
      void runTest(target, out);
    });
  }
  mount.querySelector('.st-runeval')!.addEventListener('click', () => void runEvalUI());
  mount.querySelector('.st-fb2eval')!.addEventListener('click', async () => {
    if (!curVault) return;
    try {
      const { added } = await ragEvalFromFeedback(curVault);
      evalOutEl.textContent = added > 0 ? `已导入 ${added} 条差评问题为评估草稿` : '没有新的差评问题可导入';
    } catch (e) {
      evalOutEl.textContent = `导入失败：${(e as Error).message}`;
    }
  });

  const api: ModelPane = {
    refresh(): void {
      evalOutEl.textContent = '';
      void load();
      void populateEvalVaults();
    },
    dispose(): void {
      if (saveBtnTimer !== null) clearTimeout(saveBtnTimer);
      evalVaultDd.dispose();
      mount.innerHTML = '';
    },
  };
  return api;
}
