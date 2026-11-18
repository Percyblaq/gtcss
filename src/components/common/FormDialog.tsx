import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface FormDialogProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  closeAriaLabel?: string;
  scrollResetKey?: string | number | boolean;
}

export const FormDialog: React.FC<FormDialogProps> = ({
  title,
  subtitle,
  onClose,
  onSubmit,
  children,
  footer,
  closeAriaLabel = 'Close dialog',
  scrollResetKey,
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [scrollResetKey]);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center p-0 sm:p-4 bg-[#2A2A2E]/60 backdrop-blur-xs">
      <div className="bg-white w-full h-full rounded-none border-0 sm:w-[92vw] sm:max-w-2xl sm:h-auto sm:max-h-[calc(100vh-140px)] sm:rounded-[10px] sm:border sm:border-[#E6DFD3] shadow-2xl flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#E6DFD3] bg-[#FAF8F4]">
          <div className="min-w-0">
            <h3 className="font-semibold text-base text-[#2A2A2E] truncate">{title}</h3>
            {subtitle && <p className="text-xs text-[#6E6A63]">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={closeAriaLabel}
            className="p-1.5 rounded-[8px] text-[#7F7A72] hover:text-[#2A2A2E] hover:bg-[#EFE9DF] transition-colors duration-150 shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col flex-auto min-h-0 text-xs">
          <div
            ref={scrollRef}
            className="flex-auto min-h-0 overflow-y-auto p-4 sm:p-6 space-y-5"
          >
            {children}
          </div>
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 border-t border-[#EFE9DF] bg-[#FAF8F4]">
            {footer}
          </div>
        </form>
      </div>
    </div>
  );
};
