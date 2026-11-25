import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ExternalLink, FolderOpen, Loader2, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import type { ProviderSetupAction, ProviderSetupStep, ProviderSetupView } from '../../../types/onlineMusic';
import { Button } from '../../modal/settings/kit/Button';
import { Status } from '../../modal/settings/kit/Status';
import { TextField } from '../../modal/settings/kit/TextField';
import { useKitReducedMotion } from '../../modal/settings/kit/motion';

// src/components/login/window/SetupChecklist.tsx
// 平台的配置清单，画在登录窗口那一块画和话的下面：一步一行，前面是序号（做完的是对勾，警告和出错各有记号），
// 后面是标题、说明、原样的事实、密码框和操作。清单只有平台给的数据（ProviderSetupView），这里不认识任何平台；
// 操作经账户 controller 的 runSetupAction 交给平台。

type SetupChecklistProps = {
    view: ProviderSetupView;
    /** 平台正在做一个操作：按钮都不可按。 */
    busy: boolean;
    /** 做一个操作；回 true 是平台做完了（交出的密码框据此清空、收起）。 */
    onAction: (stepId: string, actionId: string, value?: string) => Promise<boolean>;
};

const MARK_CLASS: Record<ProviderSetupStep['state'], string> = {
    done: 'bg-[var(--login-pc)] text-[color:var(--login-on-pc)]',
    todo: 'text-[color:var(--st-t2)] shadow-[inset_0_0_0_1.5px_var(--st-line2)]',
    warn: 'bg-[color-mix(in_srgb,var(--st-warn)_16%,transparent)] text-[color:var(--st-warn)]',
    error: 'bg-[color-mix(in_srgb,var(--st-err)_14%,transparent)] text-[color:var(--st-err)]',
};

const MARK_ICON: Partial<Record<ProviderSetupStep['state'], LucideIcon>> = { done: Check, warn: TriangleAlert, error: X };

const ACTION_ICON: Partial<Record<ProviderSetupAction['kind'], LucideIcon>> = { link: ExternalLink, 'pick-file': FolderOpen };

/** 清单里的一步。密码框的内容只在这一行里，交出去之后清空。 */
const SetupStepRow: React.FC<{
    step: ProviderSetupStep;
    index: number;
    busy: boolean;
    running: string | null;
    run: (step: ProviderSetupStep, action: ProviderSetupAction, value?: string) => Promise<boolean>;
}> = ({ step, index, busy, running, run }) => {
    const { t } = useTranslation();
    const reduced = useKitReducedMotion();
    const [secret, setSecret] = useState('');
    // 已经存过一份：框里只画掩码，按「更换」才能填新的。
    const [changing, setChanging] = useState(false);
    const editing = Boolean(step.secret) && (!step.secret!.saved || changing);
    const MarkIcon = MARK_ICON[step.state];
    const actions = (step.actions ?? []).filter(action => action.kind !== 'submit-secret' || editing);

    const press = async (action: ProviderSetupAction) => {
        const value = action.kind === 'submit-secret' ? secret.trim() : undefined;
        const done = await run(step, action, value);
        if (done && action.kind === 'submit-secret') {
            setSecret('');
            setChanging(false);
        }
    };

    return (
        <li className="flex gap-3 border-t border-[var(--st-line)] py-3.5 first:border-t-0">
            <span
                aria-hidden
                className={`st-t-fast mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums transition-colors ${MARK_CLASS[step.state]}`}
            >
                {MarkIcon ? <MarkIcon size={13} /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
                <h4 className="text-[13px] font-semibold leading-[22px] text-[color:var(--st-t1)]">
                    {t(step.titleKey, step.params)}
                    <span className="sr-only">{` · ${t(`login.setupState.${step.state}`)}`}</span>
                </h4>
                {step.noteKey && (
                    <p className="mt-0.5 whitespace-pre-line text-xs leading-[18px] text-[color:var(--st-t2)]">{t(step.noteKey, step.params)}</p>
                )}
                {step.detail && (
                    <p className="mt-1.5 select-text font-mono text-[11px] leading-4 text-[color:var(--st-t3)] [overflow-wrap:anywhere]">{step.detail}</p>
                )}
                {step.secret && (
                    <label className="mt-2.5 block text-xs text-[color:var(--st-t2)]">
                        {t(step.secret.labelKey)}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <TextField
                                type="password"
                                value={editing ? secret : '••••••••'}
                                onChange={setSecret}
                                disabled={!editing || busy}
                            />
                            {step.secret.saved && (
                                <Button
                                    variant="quiet"
                                    disabled={busy}
                                    onClick={() => {
                                        setChanging(value => !value);
                                        setSecret('');
                                    }}
                                >
                                    {t(changing ? 'login.setupSecretCancel' : 'login.setupSecretChange')}
                                </Button>
                            )}
                        </div>
                    </label>
                )}
                {actions.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                        {actions.map(action => {
                            const key = `${step.id}:${action.id}`;
                            const Icon = ACTION_ICON[action.kind];
                            const empty = action.kind === 'submit-secret' && !secret.trim();
                            return (
                                <Button
                                    key={action.id}
                                    variant={action.primary ? 'primary' : undefined}
                                    // 链接不改清单，平台在做操作时也能打开。
                                    disabled={(busy && action.kind !== 'link') || empty}
                                    icon={running === key ? undefined : Icon}
                                    onClick={() => void press(action)}
                                >
                                    {running === key && <Loader2 size={14} className={reduced ? undefined : 'animate-spin'} />}
                                    {t(action.labelKey)}
                                </Button>
                            );
                        })}
                    </div>
                )}
            </div>
        </li>
    );
};

export const SetupChecklist: React.FC<SetupChecklistProps> = ({ view, busy, onAction }) => {
    const { t } = useTranslation();
    // 正在做的是哪一步的哪一个操作：那个按钮转圈。
    const [running, setRunning] = useState<string | null>(null);
    // 操作是异步的：做的时候窗口关了、清单收起了，晚到的回答不再动界面。
    const mounted = useRef(true);
    useEffect(() => () => { mounted.current = false; }, []);

    // 清单出现在登录窗的中段，上面还有平台那一幅画：步骤多的清单（一家收藏夹几十上百行）第一屏会落在可视区下面，
    // 看着像什么也没有。打开时把它滚到顶，第一行就在眼前。
    const box = useRef<HTMLDivElement | null>(null);
    const firstRun = useRef(true);
    useEffect(() => {
        if (!firstRun.current) return;
        firstRun.current = false;
        box.current?.scrollIntoView({ block: 'start' });
    }, []);

    const run = async (step: ProviderSetupStep, action: ProviderSetupAction, value?: string): Promise<boolean> => {
        const key = `${step.id}:${action.id}`;
        setRunning(key);
        try {
            return await onAction(step.id, action.id, value);
        } finally {
            if (mounted.current) setRunning(current => (current === key ? null : current));
        }
    };

    return (
        <div ref={box} className="mt-5 border-t border-[var(--st-line)] pt-1">
            {view.choices && (
                <SetupChoiceList
                    choices={view.choices}
                    busy={busy}
                    onToggle={id => { void onAction(id, 'toggle'); }}
                    onAction={id => { void onAction('choices', id); }}
                />
            )}
            {view.steps.length > 0 && (
                <ol className="m-0 list-none p-0">
                    {view.steps.map((step, index) => (
                        <SetupStepRow key={step.id} step={step} index={index} busy={busy} running={running} run={run} />
                    ))}
                </ol>
            )}
            {view.message && (
                <div className="pb-1 pt-2">
                    <Status tone={view.message.tone}>{t(view.message.key, view.params)}</Status>
                </div>
            )}
        </div>
    );
};

/**
 * 一行一个的勾选列表：名字一行、小字一行，滚动区只包住列表本身，按钮钉在它下面（不随滚动跑掉）。
 * 几十上百行时用它，别用 steps —— 那种一步是三行字加一个按钮，按钮会跑到折叠线以下。
 */
const SetupChoiceList: React.FC<{
    choices: NonNullable<ProviderSetupView['choices']>;
    busy: boolean;
    onToggle: (id: string) => void;
    onAction: (id: string) => void;
}> = ({ choices, busy, onToggle, onAction }) => {
    const { t } = useTranslation();
    // 勾上就先画勾：平台回话要一个来回，等它回来才动的话，手指按下去的那一下像是没反应。
    // 平台回一份新清单时清空（那份是准的）。
    const [pending, setPending] = useState<Record<string, boolean>>({});
    const signature = choices.items.map(item => `${item.id}:${item.checked ? 1 : 0}`).join(',');
    useEffect(() => { setPending({}); }, [signature]);
    const isChecked = (item: { id: string; checked: boolean }) =>
        Object.prototype.hasOwnProperty.call(pending, item.id) ? pending[item.id] : item.checked;
    return (
        <div className="mt-2">
            {choices.summaryKey && (
                <p className="mb-1.5 text-xs leading-[18px] text-[color:var(--st-t2)]">{t(choices.summaryKey)}</p>
            )}
            <div className="max-h-[168px] overflow-y-auto rounded-[10px] border border-[var(--st-line)]">
                <ul className="m-0 list-none p-0">
                    {choices.items.map(item => (
                        <li key={item.id} className="border-b border-[var(--st-line)] last:border-b-0">
                            <label className={`flex cursor-pointer items-center gap-2.5 px-3 py-1 ${busy ? 'opacity-60' : ''}`}>
                                <input
                                    type="checkbox"
                                    className="h-3.5 w-3.5 shrink-0 accent-[var(--login-pc)]"
                                    checked={isChecked(item)}
                                    disabled={busy}
                                    onChange={() => {
                                        setPending(current => ({ ...current, [item.id]: !isChecked(item) }));
                                        onToggle(item.id);
                                    }}
                                />
                                <span className="min-w-0 flex-1 truncate text-[12.5px] leading-[18px] text-[color:var(--st-t1)]">
                                    {t(item.labelKey)}
                                </span>
                                {item.noteKey && (
                                    <span className="shrink-0 text-[11px] leading-[18px] text-[color:var(--st-t2)] tabular-nums">
                                        {t(item.noteKey)}
                                    </span>
                                )}
                            </label>
                        </li>
                    ))}
                </ul>
            </div>
            {choices.actions.length > 0 && (
                <div className="mt-2 flex items-center gap-2 border-t border-[var(--st-line)] pt-2">
                    {choices.actions.map(action => (
                        <Button
                            key={action.id}
                            variant={action.primary ? 'primary' : 'quiet'}
                            disabled={busy}
                            onClick={() => onAction(action.id)}
                        >
                            {t(action.labelKey)}
                        </Button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default SetupChecklist;
