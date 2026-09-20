/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Eve
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { copyToClipboard } from "@utils/clipboard";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, showToast, Toasts, useEffect, useMemo, UserStore, useState } from "@webpack/common";

import { CallReport, formatDuration, formatShort, ParticipantStats, reportToText, SpeakSpan } from "./stats";
import { clearReports, deleteReport, getReports, subscribeToReports } from "./tracker";

const TIMELINE_ROWS = 14;
const ROW_HEIGHT = 16;
const ROW_GAP = 4;

function avatarUrl(userId: string, guildId: string | null) {
    try {
        return UserStore.getUser(userId)?.getAvatarURL(guildId, 40) ?? null;
    } catch {
        return null;
    }
}

function Avatar({ participant, guildId }: { participant: ParticipantStats; guildId: string | null; }) {
    const url = avatarUrl(participant.userId, guildId);
    if (url) return <img className="vc-cw-avatar" src={url} alt="" />;

    return (
        <div className="vc-cw-avatar vc-cw-avatar-fallback" style={{ background: participant.color }}>
            {participant.name.slice(0, 1).toUpperCase()}
        </div>
    );
}

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string; }) {
    return (
        <div className="vc-cw-tile">
            <div className="vc-cw-tile-value">{value}</div>
            <div className="vc-cw-tile-label">{label}</div>
            {hint && <div className="vc-cw-tile-hint">{hint}</div>}
        </div>
    );
}

/**
 * One row per person, every stretch they held the mic drawn to scale. The shape of a
 * call is usually obvious at a glance here - one long bar and a lot of short ones, or
 * a proper back and forth.
 */
function Timeline({ report }: { report: CallReport; }) {
    const rows = useMemo(() => {
        const spoke = report.participants.filter(p => p.talkTime > 0).slice(0, TIMELINE_ROWS);
        const byUser = new Map<string, SpeakSpan[]>();
        for (const span of report.spans) {
            const list = byUser.get(span.u);
            if (list) list.push(span);
            else byUser.set(span.u, [span]);
        }
        return spoke.map(p => ({ participant: p, spans: byUser.get(p.userId) ?? [] }));
    }, [report]);

    if (!rows.length || report.duration <= 0) return null;

    const height = rows.length * (ROW_HEIGHT + ROW_GAP);
    const scale = (ms: number) => (ms / report.duration) * 1000;

    return (
        <div className="vc-cw-section">
            <div className="vc-cw-section-title">Who had the mic, and when</div>
            <svg
                className="vc-cw-timeline"
                viewBox={`0 0 1000 ${height}`}
                preserveAspectRatio="none"
                style={{ height }}
                role="img"
                aria-label="Speaking timeline"
            >
                {rows.map((row, i) => (
                    <g key={row.participant.userId}>
                        <rect
                            className="vc-cw-timeline-track"
                            x={0}
                            y={i * (ROW_HEIGHT + ROW_GAP)}
                            width={1000}
                            height={ROW_HEIGHT}
                            rx={3}
                        />
                        {row.spans.map((span, j) => (
                            <rect
                                key={j}
                                x={scale(span.s)}
                                y={i * (ROW_HEIGHT + ROW_GAP)}
                                width={Math.max(1.2, scale(span.e - span.s))}
                                height={ROW_HEIGHT}
                                rx={2}
                                fill={row.participant.color}
                            >
                                <title>{`${row.participant.name} · ${formatShort(span.e - span.s)} at ${formatDuration(span.s)}`}</title>
                            </rect>
                        ))}
                    </g>
                ))}
            </svg>
            <div className="vc-cw-timeline-axis">
                <span>0:00</span>
                <span>{formatDuration(report.duration / 2)}</span>
                <span>{formatDuration(report.duration)}</span>
            </div>
            <div className="vc-cw-timeline-legend">
                {rows.map(row => (
                    <span className="vc-cw-legend-item" key={row.participant.userId}>
                        <span className="vc-cw-legend-dot" style={{ background: row.participant.color }} />
                        {row.participant.name}
                    </span>
                ))}
            </div>
        </div>
    );
}

function TalkTimes({ report }: { report: CallReport; }) {
    const max = Math.max(...report.participants.map(p => p.talkTime), 1);

    return (
        <div className="vc-cw-section">
            <div className="vc-cw-section-title">Talk time</div>
            <div className="vc-cw-bars">
                {report.participants.map(p => (
                    <div className="vc-cw-bar-row" key={p.userId}>
                        <Avatar participant={p} guildId={report.guildId} />
                        <div className="vc-cw-bar-name">{p.name}</div>
                        <div className="vc-cw-bar-track">
                            <div
                                className="vc-cw-bar-fill"
                                style={{ width: `${(p.talkTime / max) * 100}%`, background: p.color }}
                            />
                        </div>
                        <div className="vc-cw-bar-value">
                            {p.talkTime ? formatDuration(p.talkTime) : "silent"}
                            <span className="vc-cw-bar-share">{p.talkTime ? ` ${Math.round(p.share * 100)}%` : ""}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function Awards({ report }: { report: CallReport; }) {
    if (!report.awards.length) return null;

    const byId = new Map(report.participants.map(p => [p.userId, p]));

    return (
        <div className="vc-cw-section">
            <div className="vc-cw-section-title">Awards</div>
            <div className="vc-cw-awards">
                {report.awards.map(award => {
                    const winner = byId.get(award.userIds[0]);
                    return (
                        <div className="vc-cw-award" key={award.id}>
                            <div className="vc-cw-award-emoji">{award.emoji}</div>
                            <div className="vc-cw-award-body">
                                <div className="vc-cw-award-title">
                                    {award.title}
                                    {award.userIds.length === 1 && winner && (
                                        <span className="vc-cw-award-winner" style={{ color: winner.color }}> · {winner.name}</span>
                                    )}
                                </div>
                                <div className="vc-cw-award-detail">{award.detail}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function Details({ report }: { report: CallReport; }) {
    const talkers = report.participants.filter(p => p.talkTime > 0);
    if (!talkers.length) return null;

    return (
        <div className="vc-cw-section">
            <div className="vc-cw-section-title">The fine print</div>
            <table className="vc-cw-table">
                <thead>
                    <tr>
                        <th>Person</th>
                        <th>Turns</th>
                        <th>Avg turn</th>
                        <th>Longest</th>
                        <th title="Times they took the floor off someone else">Cut in</th>
                        <th title="Times someone took the floor off them">Cut off</th>
                    </tr>
                </thead>
                <tbody>
                    {talkers.map(p => (
                        <tr key={p.userId}>
                            <td><span className="vc-cw-legend-dot" style={{ background: p.color }} />{p.name}</td>
                            <td>{p.turns}</td>
                            <td>{formatShort(p.avgTurn)}</td>
                            <td>{formatShort(p.longestTurn)}</td>
                            <td>{p.interruptionsMade || "-"}</td>
                            <td>{p.interruptionsTaken || "-"}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ReportModal({ report, ...props }: RenderModalProps & { report: CallReport; }) {
    const deadAirPercent = report.duration ? Math.round((report.deadAir / report.duration) * 100) : 0;
    const when = new Date(report.startedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short"
    });

    return (
        <Modal
            {...props}
            size="lg"
            title={<span className="vc-cw-title">Call Wrapped</span>}
            subtitle={`${report.guildName ? `${report.guildName} · ` : ""}${report.channelName} · ${when}`}
            actions={[
                {
                    text: "Copy as text",
                    variant: "secondary",
                    onClick: () => {
                        copyToClipboard(reportToText(report));
                        showToast("Report copied - paste it into the chat", Toasts.Type.SUCCESS);
                    }
                },
                {
                    text: "Close",
                    variant: "primary",
                    onClick: props.onClose
                }
            ]}
        >
            <div className="vc-cw-body">
                <div className="vc-cw-tiles">
                    <StatTile label="Length" value={formatDuration(report.duration)} />
                    <StatTile label="People" value={String(report.participants.length)} />
                    <StatTile label="Turns" value={String(report.totalTurns)} />
                    <StatTile label="Dead air" value={`${deadAirPercent}%`} hint={formatDuration(report.deadAir)} />
                    <StatTile label="Talking over each other" value={formatShort(report.overlap)} />
                </div>

                <Timeline report={report} />
                <TalkTimes report={report} />
                <Awards report={report} />
                <Details report={report} />
            </div>
        </Modal>
    );
}

export function openReport(report: CallReport) {
    openModal(props => (
        <ErrorBoundary>
            <ReportModal {...props} report={report} />
        </ErrorBoundary>
    ));
}

function HistoryModal(props: RenderModalProps) {
    const [reports, setReports] = useState(getReports());

    useEffect(() => subscribeToReports(() => setReports([...getReports()])), []);

    return (
        <Modal
            {...props}
            size="md"
            title="Call Wrapped history"
            subtitle={reports.length ? `${reports.length} saved ${reports.length === 1 ? "report" : "reports"}` : undefined}
            actions={[
                {
                    text: "Clear all",
                    variant: "critical-primary",
                    disabled: !reports.length,
                    onClick: () => void clearReports()
                },
                {
                    text: "Close",
                    variant: "primary",
                    onClick: props.onClose
                }
            ]}
        >
            <div className="vc-cw-body">
                {!reports.length && (
                    <div className="vc-cw-empty">
                        No reports yet. Hang up on a call and one will show up here.
                    </div>
                )}
                {reports.map(report => (
                    <div className="vc-cw-history-row" key={report.id}>
                        <div className="vc-cw-history-main" onClick={() => openReport(report)}>
                            <div className="vc-cw-history-name">
                                {report.guildName ? `${report.guildName} · ` : ""}{report.channelName}
                            </div>
                            <div className="vc-cw-history-meta">
                                {new Date(report.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                                {" · "}{formatDuration(report.duration)}
                                {" · "}{report.participants.length} people
                            </div>
                        </div>
                        <button
                            className="vc-cw-history-delete"
                            onClick={() => void deleteReport(report.id)}
                            aria-label="Delete this report"
                        >
                            ✕
                        </button>
                    </div>
                ))}
            </div>
        </Modal>
    );
}

export function openHistory() {
    openModal(props => (
        <ErrorBoundary>
            <HistoryModal {...props} />
        </ErrorBoundary>
    ));
}
