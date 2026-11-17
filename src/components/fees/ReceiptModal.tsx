import React, { useMemo, useState } from 'react';
import { CheckCircle2, Download, Printer, ShieldCheck, X } from 'lucide-react';
import { FeePayment, SchoolSetting, StudentFee } from '../../types';
import {
  computeInstallmentHistoryForFee,
  downloadPaymentReceiptPDF,
  formatNaira,
} from '../../services/feesService';
import { SchoolLogo } from '../common/SchoolLogo';

interface ReceiptModalProps {
  payment: FeePayment;
  feeItem?: StudentFee;
  paymentsForFee?: FeePayment[];
  schoolSettings: SchoolSetting;
  onClose: () => void;
}

export const ReceiptModal: React.FC<ReceiptModalProps> = ({
  payment,
  feeItem,
  paymentsForFee,
  schoolSettings,
  onClose,
}) => {
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);

  const installmentStats = useMemo(() => {
    if (!feeItem) return null;
    const history =
      paymentsForFee && paymentsForFee.length > 0
        ? computeInstallmentHistoryForFee(feeItem, paymentsForFee)
        : [];
    const entry = history.find((h) => h.payment.id === payment.id);
    const totalPaidSoFar = entry ? entry.cumulativePaidAfter : feeItem.amountPaid;
    const remainingBalance = entry ? entry.runningBalanceAfter : feeItem.balance;
    const installmentNumber = entry ? entry.installmentNumber : null;
    const isFullyPaid = !payment.isVoided && remainingBalance === 0;
    return {
      totalPaidSoFar,
      remainingBalance,
      installmentNumber,
      isFullyPaid,
    };
  }, [feeItem, paymentsForFee, payment.id, payment.isVoided]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#2A2A2E]/60 backdrop-blur-xs print-only-container">
      <div className="bg-white rounded-[10px] max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-[#E6DFD3] relative print-only-card max-h-[94vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="no-print absolute top-4 right-4 p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#FAF8F4] transition-colors duration-150"
        >
          <X className="w-5 h-5" />
        </button>

        {/* School Branding */}
        <div className="text-center pb-5 border-b border-[#B8913A]/60 border-dashed">
          <div className="flex justify-center mb-2">
            <SchoolLogo
              logoDataUrl={schoolSettings.logoDataUrl}
              schoolName={schoolSettings.schoolName}
              size="lg"
              variant="print"
            />
          </div>
          <h2 className="font-serif text-lg font-semibold text-[#6B1020] tracking-tight">
            {schoolSettings.schoolName}
          </h2>
          <p className="text-xs text-[#5E5B56] font-medium mt-0.5">{schoolSettings.address}</p>
          <p className="text-xs text-[#6E6A63]">
            {[
              schoolSettings.phone && `Tel: ${schoolSettings.phone}`,
              schoolSettings.email,
              schoolSettings.website,
            ]
              .filter(Boolean)
              .join(' • ')}
          </p>
          <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
            <span className="inline-block bg-[#6B1020] text-[#DFC484] border border-[#B8913A]/50 px-3.5 py-1 rounded-full text-[11px] font-semibold uppercase tracking-wider">
              Official Bursary Payment Receipt
            </span>
            {installmentStats?.isFullyPaid && (
              <span className="inline-flex items-center gap-1 bg-[#EEF4F0] text-[#2A583B] border border-[#C5D6CB] px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider">
                <CheckCircle2 className="w-3 h-3" />
                Fully Paid
              </span>
            )}
            {payment.isEdited && (
              <span className="inline-block bg-[#FBF5E8] text-[#7D5A18] border border-[#E3CFA6] px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider">
                Edited
              </span>
            )}
            {payment.isVoided && (
              <span className="inline-block bg-[#FEF2F2] text-[#B91C1C] border border-[#FECACA] px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider">
                Voided
              </span>
            )}
          </div>
        </div>

        {/* Receipt Metadata */}
        <div className="py-4 space-y-2.5 text-xs border-b border-[#EFE9DF]">
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Receipt No:</span>
            <strong className="font-mono text-[#6B1020]">{payment.receiptNo}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Payment Date:</span>
            <strong className="text-[#2A2A2E]">{payment.paymentDate}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Student Name:</span>
            <strong className="text-[#2A2A2E]">{payment.studentName}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Admission No:</span>
            <strong className="font-mono text-[#2A2A2E]">{payment.admissionNo}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Class:</span>
            <strong className="text-[#2A2A2E]">{payment.className}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Session & Term:</span>
            <strong className="text-[#2A2A2E]">
              {payment.session} • {payment.term}
            </strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Payment Method:</span>
            <strong className="text-[#2A2A2E]">{payment.paymentMethod}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-[#6E6A63]">Transaction Reference:</span>
            <strong className="font-mono text-[#2A2A2E]">{payment.transactionRef}</strong>
          </div>
          {payment.notes && (
            <div className="flex justify-between gap-4">
              <span className="text-[#6E6A63] shrink-0">Notes:</span>
              <span className="text-[#5E5B56] text-right">{payment.notes}</span>
            </div>
          )}
        </div>

        {/* Payment Summary */}
        <div className="py-4">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-[#E6DFD3] bg-[#FAF8F4] text-[#5E5B56] font-semibold uppercase text-[10px]">
                <th className="py-1.5 px-2">Fee Category</th>
                <th className="py-1.5 px-2 text-right">This Payment (₦)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EFE9DF]">
              <tr>
                <td className="py-2.5 px-2 text-[#2A2A2E] font-semibold">
                  {payment.categoryName}
                  {installmentStats?.installmentNumber && (
                    <span className="ml-1.5 text-[10px] font-medium text-[#6E6A63]">
                      (Installment #{installmentStats.installmentNumber})
                    </span>
                  )}
                </td>
                <td className="py-2.5 px-2 text-right font-semibold text-[#2A2A2E] tabular-nums">
                  {formatNaira(payment.amount)}
                </td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 pt-3 border-t-2 border-[#6B1020] flex justify-between items-center">
            <span className="font-semibold text-sm text-[#2A2A2E]">
              {payment.isVoided ? 'Voided Amount:' : 'Amount Paid (This Receipt):'}
            </span>
            <span
              className={`font-bold text-xl tabular-nums ${
                payment.isVoided ? 'text-[#B91C1C] line-through' : 'text-[#6B1020]'
              }`}
            >
              {formatNaira(payment.amount)}
            </span>
          </div>
          {payment.isVoided && payment.voidReason && (
            <div className="mt-2 bg-[#FEF2F2] border border-[#FECACA] text-[#991B1B] rounded-[8px] px-3 py-2 text-[11px]">
              <strong>Voided:</strong> {payment.voidReason}
            </div>
          )}

          {feeItem && installmentStats && (
            <div className="mt-3 bg-[#FAF8F4] rounded-[8px] p-3 border border-[#E6DFD3] space-y-2 text-[11px] text-[#5E5B56] tabular-nums">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#6E6A63] block">
                    Expected Fee
                  </span>
                  <strong className="text-[#2A2A2E]">{formatNaira(feeItem.amountDue)}</strong>
                </div>
                <div>
                  <span className="text-[10px] uppercase tracking-wider text-[#2A583B] block">
                    Total Paid So Far
                  </span>
                  <strong className="text-[#2A583B]">
                    {formatNaira(installmentStats.totalPaidSoFar)}
                  </strong>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase tracking-wider text-[#7D5A18] block">
                    Remaining Balance
                  </span>
                  <strong
                    className={
                      installmentStats.isFullyPaid ? 'text-[#2A583B]' : 'text-[#7D5A18]'
                    }
                  >
                    {formatNaira(installmentStats.remainingBalance)}
                  </strong>
                </div>
              </div>
              {installmentStats.isFullyPaid && (
                <div className="pt-2 border-t border-[#E6DFD3] flex items-center justify-center gap-1.5 text-[#2A583B] font-semibold">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Fully Paid — No Outstanding Balance on This Fee Item</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Verification Sign-off */}
        <div className="pt-3 flex items-center justify-between text-[11px] text-[#6E6A63]">
          <div className="border border-[#C5D6CB] text-[#2A583B] bg-[#EEF4F0] px-3 py-1.5 rounded-[8px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[#2A583B]" />
            Bursary Recorded
          </div>
          <div className="text-right">
            <span className="block italic text-[#7F7A72]">Recorded By</span>
            <span className="font-semibold text-[#2A2A2E]">{payment.recordedBy}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-6 flex flex-wrap justify-end gap-2 no-print">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-[8px] bg-white hover:bg-[#FAF8F4] border border-[#DDD5C7] text-[#2A2A2E] font-medium text-xs transition-colors duration-150"
          >
            Close
          </button>
          <button
            type="button"
            disabled={isDownloadingPdf}
            onClick={async () => {
              setIsDownloadingPdf(true);
              try {
                await downloadPaymentReceiptPDF({
                  payment,
                  schoolSettings,
                  feeItem,
                  paymentsForFee,
                });
              } finally {
                setIsDownloadingPdf(false);
              }
            }}
            className="px-4 py-2 rounded-[8px] bg-[#FAF8F4] hover:bg-[#EFE9DF] border border-[#B8913A]/60 text-[#6B1020] font-medium text-xs inline-flex items-center gap-1.5 disabled:opacity-50 transition-colors duration-150"
          >
            <Download className="w-3.5 h-3.5" />
            {isDownloadingPdf ? 'Preparing PDF...' : 'Download PDF'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-4 py-2 rounded-[8px] bg-[#6B1020] hover:bg-[#540C19] text-white font-medium text-xs inline-flex items-center gap-1.5 transition-colors duration-150"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Receipt
          </button>
        </div>
      </div>
    </div>
  );
};
