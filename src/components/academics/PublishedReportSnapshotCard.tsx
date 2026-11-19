import React, { useState } from 'react';
import {
  Award,
  CheckCircle2,
  Download,
  Globe,
  Printer,
  ShieldCheck,
} from 'lucide-react';
import { PublishedReportSnapshot, SchoolSetting } from '../../types';
import {
  downloadPublishedSnapshotPDF,
  formatOrdinal,
} from '../../services/academicService';
import { SchoolLogo } from '../common/SchoolLogo';

interface PublishedReportSnapshotCardProps {
  snapshot: PublishedReportSnapshot;
  schoolSettings: SchoolSetting;
  onPrint?: () => void;
  showPublishMetaBanner?: boolean;
}

function formatReadableDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString('en-NG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export const PublishedReportSnapshotCard: React.FC<PublishedReportSnapshotCardProps> = ({
  snapshot,
  schoolSettings,
  onPrint,
  showPublishMetaBanner = true,
}) => {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const showTeacherBox = snapshot.enableTeacherComment !== false;
  const showHeadBox = snapshot.enableHeadComment !== false;
  const showPrincipalBox = snapshot.enablePrincipalComment !== false;

  const headTitle = snapshot.headCommentTitle || 'Headmaster';
  const teacherCommentText = (snapshot.teacherComment || '').trim();
  const headCommentText = (snapshot.headComment || '').trim();
  const principalCommentText = (snapshot.principalComment || '').trim();
  const approvedAtFormatted = formatReadableDate(snapshot.approvedAt);
  const publishedAtFormatted = formatReadableDate(snapshot.publishedAt);
  const republishedAtFormatted = formatReadableDate(snapshot.republishedAt);

  return (
    <div className="space-y-4">
      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 no-print">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
            <Globe className="w-3.5 h-3.5" />
            Published Official Report
            {publishedAtFormatted ? ` • ${publishedAtFormatted}` : ''}
          </span>
          {showPublishMetaBanner && republishedAtFormatted && snapshot.publishCount > 1 && (
            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium bg-[#FAF8F4] text-[#5E5B56] border border-[#E6DFD3]">
              Updated {republishedAtFormatted}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isDownloadingPdf}
            onClick={async () => {
              setIsDownloadingPdf(true);
              try {
                await downloadPublishedSnapshotPDF(snapshot, schoolSettings);
              } finally {
                setIsDownloadingPdf(false);
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] text-xs font-medium transition-colors duration-150 disabled:opacity-50"
          >
            <Download className="w-3.5 h-3.5 text-[#6B1020]" />
            {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => (onPrint ? onPrint() : window.print())}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white text-xs font-medium transition-colors duration-150"
          >
            <Printer className="w-3.5 h-3.5" />
            Print
          </button>
        </div>
      </div>

      {/* Read-only Printable Report Card Dossier */}
      <div className="bg-white rounded-[10px] border border-[#DDD5C7] p-6 sm:p-10 shadow-[0_1px_2px_rgba(42,42,46,0.04),0_6px_16px_rgba(42,42,46,0.04)] print-only-card">
        {/* School Crest & Header */}
        <div className="text-center pb-5 border-b-2 border-[#6B1020]">
          <div className="flex items-center justify-center mb-2.5">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="2xl"
              variant="print"
            />
          </div>
          <h2 className="font-serif text-xl sm:text-2xl font-semibold text-[#6B1020] tracking-tight">
            {schoolSettings.schoolName}
          </h2>
          {schoolSettings.motto && (
            <p className="text-xs italic font-medium text-[#7D5A18] mt-0.5">
              {schoolSettings.motto}
            </p>
          )}
          <p className="text-xs text-[#5E5B56] mt-1">{schoolSettings.address}</p>
          <p className="text-xs text-[#6E6A63]">
            {[
              schoolSettings.phone && `Tel: ${schoolSettings.phone}`,
              schoolSettings.email && `Email: ${schoolSettings.email}`,
              schoolSettings.website,
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>

          <div className="mt-4 inline-block bg-[#6B1020] text-[#DFC484] border border-[#B8913A]/50 px-6 py-1.5 rounded-full text-xs font-semibold uppercase tracking-widest">
            Official Terminal Report Card
          </div>
        </div>

        {/* Pupil Biodata & Summary Grid */}
        <div className="flex flex-col sm:flex-row gap-4 py-5 border-b border-[#E6DFD3] items-start sm:items-center">
          {snapshot.passportPhoto ? (
            <img
              src={snapshot.passportPhoto}
              alt={snapshot.studentName}
              className="w-20 h-24 rounded-[10px] object-cover border border-[#E6DFD3] shrink-0"
            />
          ) : (
            <div className="w-20 h-24 rounded-[10px] bg-[#6B1020] text-white font-semibold text-xl flex items-center justify-center shrink-0">
              {snapshot.studentName.charAt(0)}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 flex-1 text-xs w-full">
            <div>
              <span className="text-[#6E6A63] block font-medium">Student Name:</span>
              <strong className="text-[#2A2A2E] text-sm">{snapshot.studentName}</strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Admission Number:</span>
              <strong className="text-[#2A2A2E] font-mono text-sm">
                {snapshot.admissionNo}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Class &amp; Section:</span>
              <strong className="text-[#2A2A2E] text-sm">
                {snapshot.className}
                {snapshot.section ? ` (${snapshot.section})` : ''}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Session &amp; Term:</span>
              <strong className="text-[#2A2A2E] text-sm">
                {snapshot.session} • {snapshot.term}
              </strong>
            </div>

            <div>
              <span className="text-[#6E6A63] block font-medium">Class Position:</span>
              <strong className="text-[#2A583B] text-sm tabular-nums">
                {snapshot.position
                  ? `${formatOrdinal(snapshot.position)} out of ${snapshot.totalRankedStudents}`
                  : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Term Average:</span>
              <strong className="text-[#6B1020] text-sm font-bold tabular-nums">
                {snapshot.subjectsCount > 0 ? `${snapshot.averagePercentage}%` : '—'}
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Overall Grade:</span>
              <strong className="text-[#2A2A2E] text-sm font-mono">
                {snapshot.overallGrade} ({snapshot.overallRemark})
              </strong>
            </div>
            <div>
              <span className="text-[#6E6A63] block font-medium">Published Date:</span>
              <strong className="text-[#2A583B]">
                {publishedAtFormatted || 'Published'}
              </strong>
            </div>
          </div>
        </div>

        {/* Attendance Summary */}
        <div className="py-4 border-b border-[#E6DFD3]">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#5E5B56] mb-2">
            Term Attendance Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 text-xs tabular-nums">
            <div className="bg-[#FAF8F4] p-2.5 rounded-[8px] border border-[#E6DFD3]">
              <span className="text-[10px] text-[#6E6A63] block">Days Recorded</span>
              <strong className="text-[#2A2A2E]">{snapshot.attendance.totalRecords}</strong>
            </div>
            <div className="bg-[#EEF4F0] p-2.5 rounded-[8px] border border-[#C5D6CB]">
              <span className="text-[10px] text-[#2A583B] block">Present</span>
              <strong className="text-[#2A583B]">{snapshot.attendance.present}</strong>
            </div>
            <div className="bg-[#FBF5E8] p-2.5 rounded-[8px] border border-[#E3CFA6]">
              <span className="text-[10px] text-[#7D5A18] block">Late</span>
              <strong className="text-[#7D5A18]">{snapshot.attendance.late}</strong>
            </div>
            <div className="bg-[#FAF0F2] p-2.5 rounded-[8px] border border-[#E2C1C5]">
              <span className="text-[10px] text-[#86222E] block">Absent</span>
              <strong className="text-[#86222E]">{snapshot.attendance.absent}</strong>
            </div>
            <div className="bg-[#FAF0F2] p-2.5 rounded-[8px] border border-[#DFC7CA]">
              <span className="text-[10px] text-[#6B1020] block">Excused</span>
              <strong className="text-[#6B1020]">{snapshot.attendance.excused}</strong>
            </div>
            <div className="bg-[#6B1020] text-white p-2.5 rounded-[8px] border border-[#B8913A]/40">
              <span className="text-[10px] text-[#F7F4EF]/80 block">Attendance %</span>
              <strong className="text-[#DFC484]">
                {snapshot.attendance.totalRecords > 0
                  ? `${snapshot.attendance.attendanceRate}%`
                  : '0%'}
              </strong>
            </div>
          </div>
        </div>

        {/* Academic Marks Table */}
        <div className="py-5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[#5E5B56] mb-3">
            Cognitive Academic Performance
          </h3>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-[#E6DFD3]">
              <thead className="bg-[#FAF8F4] text-[11px] font-semibold text-[#5E5B56] uppercase border-b border-[#E6DFD3]">
                <tr>
                  <th className="py-2.5 px-3 border-r border-[#E6DFD3]">Subject</th>
                  {snapshot.components.map((comp) => (
                    <th
                      key={comp.id}
                      className="py-2.5 px-3 text-center border-r border-[#E6DFD3]"
                    >
                      {comp.label} ({comp.maxMark})
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3] font-bold">
                    Total ({snapshot.components.reduce((s, c) => s + c.maxMark, 0)})
                  </th>
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3]">%</th>
                  <th className="py-2.5 px-3 text-center border-r border-[#E6DFD3]">Grade</th>
                  <th className="py-2.5 px-3">Teacher Remark</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EFE9DF] tabular-nums">
                {snapshot.records.length === 0 ? (
                  <tr>
                    <td
                      colSpan={snapshot.components.length + 5}
                      className="py-8 text-center text-[#7F7A72]"
                    >
                      No subject assessment scores recorded in this snapshot.
                    </td>
                  </tr>
                ) : (
                  snapshot.records.map((rec, idx) => (
                    <tr
                      key={`${rec.subject}-${idx}`}
                      className="hover:bg-[#FAF8F4] transition-colors duration-150"
                    >
                      <td className="py-2.5 px-3 font-semibold text-[#2A2A2E] border-r border-[#E6DFD3]">
                        {rec.subject}
                      </td>
                      {snapshot.components.map((comp) => {
                        let val = 0;
                        if (rec.componentScores && rec.componentScores[comp.key] !== undefined) {
                          val = rec.componentScores[comp.key];
                        } else if (comp.key === 'ca1') {
                          val = rec.ca1 ?? 0;
                        } else if (comp.key === 'ca2') {
                          val = rec.ca2 ?? 0;
                        } else if (comp.key === 'exam' || comp.isExam) {
                          val = rec.exam ?? 0;
                        }
                        return (
                          <td
                            key={comp.id}
                            className="py-2.5 px-3 text-center border-r border-[#E6DFD3] text-[#2A2A2E]"
                          >
                            {val}
                          </td>
                        );
                      })}
                      <td className="py-2.5 px-3 text-center font-semibold text-[#6B1020] border-r border-[#E6DFD3]">
                        {rec.total}
                      </td>
                      <td className="py-2.5 px-3 text-center border-r border-[#E6DFD3] text-[#2A2A2E]">
                        {rec.percentage}%
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono font-semibold border-r border-[#E6DFD3] text-[#2A583B]">
                        {rec.grade}
                      </td>
                      <td className="py-2.5 px-3 text-[#5E5B56]">{rec.remark}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Grading Scale & Ranking Policy */}
        <div className="bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] text-[11px] text-[#5E5B56] space-y-1 mb-5">
          <div className="flex items-center gap-1.5 font-semibold text-[#2A2A2E]">
            <Award className="w-3.5 h-3.5 text-[#B8913A]" />
            School Grading Key &amp; Ranking Policy
          </div>
          <p className="font-mono">
            {snapshot.gradingScale
              .map((g) => `${g.grade}: ${g.minScore}–${g.maxScore}% (${g.remark})`)
              .join(' • ')}
          </p>
          <p>
            <strong>Class Ranking Policy:</strong>{' '}
            {snapshot.rankingPolicy === 'dense'
              ? 'Dense Ranking (1, 2, 2, 3) ordered by Term Average (%) across saved subjects.'
              : 'Standard Competition Ranking (1, 2, 2, 4) ordered by Term Average (%) across saved subjects.'}
          </p>
        </div>

        {/* Three-Tier Comments & Signatures (Read-only) */}
        {(showTeacherBox || showHeadBox || showPrincipalBox) && (
          <div className="pt-4 border-t border-[#E6DFD3] space-y-3 text-xs">
            {showTeacherBox && (
              <div className="bg-[#FAF8F4] p-4 rounded-[8px] border border-[#E6DFD3]">
                <span className="font-semibold text-[#2A2A2E] block mb-1.5">
                  Form / Class Teacher&apos;s Comment:
                </span>
                {teacherCommentText ? (
                  <p className="italic text-[#2A2A2E] leading-relaxed">
                    &ldquo;{teacherCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic">—</p>
                )}
                {teacherCommentText && (snapshot.teacherCommentBy || snapshot.teacherCommentAt) && (
                  <div className="mt-2 pt-2 border-t border-[#E6DFD3]/70 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#6E6A63]">
                    <span>
                      {snapshot.teacherCommentAt
                        ? `Updated: ${formatReadableDate(snapshot.teacherCommentAt)}`
                        : ''}
                    </span>
                    {snapshot.teacherCommentBy && (
                      <span className="font-medium text-[#2A2A2E]">
                        Signed: {snapshot.teacherCommentBy}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {showHeadBox && (
              <div className="bg-[#FBF8F1] p-4 rounded-[8px] border border-[#E3CFA6]">
                <span className="font-semibold text-[#7D5A18] block mb-1.5">
                  Headmaster&apos;s/Headmistress&apos;s Comment:
                </span>
                {headCommentText ? (
                  <p className="italic text-[#2A2A2E] leading-relaxed">
                    &ldquo;{headCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic">—</p>
                )}
                {(snapshot.headCommentBy || snapshot.headSignature || snapshot.headCommentAt) && (
                  <div className="mt-2.5 pt-2 border-t border-[#E3CFA6]/70 flex flex-wrap items-end justify-between gap-3 text-[11px] text-[#6E6A63]">
                    <div>
                      {snapshot.headCommentAt && (
                        <span>Date: {formatReadableDate(snapshot.headCommentAt)}</span>
                      )}
                    </div>
                    <div className="flex items-end gap-3 ml-auto">
                      {snapshot.headSignature && (
                        <img
                          src={snapshot.headSignature}
                          alt={`${headTitle} signature`}
                          className="max-h-10 max-w-[110px] object-contain"
                        />
                      )}
                      {snapshot.headCommentBy && (
                        <span>
                          {headTitle}:{' '}
                          <strong className="text-[#2A2A2E]">{snapshot.headCommentBy}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {showPrincipalBox && (
              <div className="bg-[#FAF0F2]/50 p-4 rounded-[8px] border border-[#DFC7CA]">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <span className="font-semibold text-[#6B1020]">
                    Principal&apos;s Comment &amp; Approval:
                  </span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB]">
                    <CheckCircle2 className="w-3 h-3" />
                    Approved{approvedAtFormatted ? ` • ${approvedAtFormatted}` : ''}
                  </span>
                </div>
                {principalCommentText ? (
                  <p className="italic text-[#2A2A2E] font-medium leading-relaxed">
                    &ldquo;{principalCommentText}&rdquo;
                  </p>
                ) : (
                  <p className="text-[#7F7A72] italic">—</p>
                )}

                <div className="mt-3 pt-2 border-t border-[#DFC7CA]/60 flex flex-wrap items-end justify-between gap-3 text-[11px] text-[#6E6A63]">
                  <div className="space-y-0.5">
                    <div>
                      Next Term Resumption:{' '}
                      <strong className="text-[#2A2A2E]">
                        {snapshot.nextTermResumption ||
                          schoolSettings.nextTermResumption ||
                          'To be announced'}
                      </strong>
                    </div>
                    {approvedAtFormatted && (
                      <div>
                        Approval Date:{' '}
                        <strong className="text-[#2A583B]">{approvedAtFormatted}</strong>
                      </div>
                    )}
                  </div>

                  <div className="flex items-end gap-3 ml-auto">
                    {snapshot.principalSignature && (
                      <img
                        src={snapshot.principalSignature}
                        alt="Principal signature"
                        className="max-h-10 max-w-[110px] object-contain"
                      />
                    )}
                    {(snapshot.principalCommentBy || snapshot.approvedBy) && (
                      <span>
                        Signed:{' '}
                        <strong className="text-[#2A2A2E]">
                          {snapshot.principalCommentBy || snapshot.approvedBy}
                        </strong>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Frozen Snapshot Authenticity Footer */}
        <div className="mt-5 pt-3 border-t border-[#EFE9DF] flex flex-wrap items-center justify-between gap-2 text-[10px] text-[#7F7A72]">
          <span className="inline-flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#2A583B]" />
            Verified Official Published Copy • Published {publishedAtFormatted || '—'}
          </span>
          <span>Read-Only Snapshot ({snapshot.session} • {snapshot.term})</span>
        </div>
      </div>
    </div>
  );
};
