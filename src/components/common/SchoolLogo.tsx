import React, { useEffect, useState } from 'react';
import { GraduationCap } from 'lucide-react';

export type SchoolLogoSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type SchoolLogoVariant = 'default' | 'light' | 'dark' | 'print';

interface SchoolLogoProps {
  logoDataUrl?: string;
  schoolName?: string;
  size?: SchoolLogoSize;
  variant?: SchoolLogoVariant;
  className?: string;
}

const SIZE_CLASSES: Record<SchoolLogoSize, { box: string; icon: string; padding: string }> = {
  xs: { box: 'w-7 h-7 rounded-[8px]', icon: 'w-4 h-4', padding: 'p-0.5' },
  sm: { box: 'w-8 h-8 rounded-[8px]', icon: 'w-4 h-4', padding: 'p-1' },
  md: { box: 'w-10 h-10 rounded-[10px]', icon: 'w-5 h-5', padding: 'p-1' },
  lg: { box: 'w-12 h-12 rounded-[10px]', icon: 'w-6 h-6', padding: 'p-1' },
  xl: { box: 'w-14 h-14 rounded-[10px]', icon: 'w-7 h-7', padding: 'p-1.5' },
  '2xl': { box: 'w-20 h-20 rounded-[10px]', icon: 'w-9 h-9', padding: 'p-1.5' },
};

export const SchoolLogo: React.FC<SchoolLogoProps> = ({
  logoDataUrl,
  schoolName = "Great God's Time Comprehensive School",
  size = 'md',
  variant = 'default',
  className = '',
}) => {
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [logoDataUrl]);

  const sizeCfg = SIZE_CLASSES[size];
  const hasCustomLogo = Boolean(logoDataUrl && logoDataUrl.trim()) && !imgError;

  if (hasCustomLogo) {
    const surfaceClasses =
      variant === 'light'
        ? 'bg-white/95 border border-[#B8913A]/60 shadow-xs'
        : variant === 'print'
          ? 'bg-white border border-[#D8D0C3]'
          : 'bg-white border border-[#E2DACD] shadow-xs';

    return (
      <div
        className={`${sizeCfg.box} ${sizeCfg.padding} ${surfaceClasses} flex items-center justify-center overflow-hidden shrink-0 ${className}`}
      >
        <img
          src={logoDataUrl}
          alt={`${schoolName} Logo`}
          onError={() => setImgError(true)}
          className="w-full h-full object-contain select-none"
        />
      </div>
    );
  }

  // Fallback geometric crest icon when no custom logo is uploaded
  const fallbackSurface =
    variant === 'light'
      ? 'bg-[#540C19] text-[#DFC484] border border-[#B8913A]/60'
      : 'bg-[#FAF0F2] text-[#6B1020] border border-[#E2DACD]';

  return (
    <div
      aria-label={`${schoolName} Default Emblem`}
      className={`${sizeCfg.box} ${fallbackSurface} flex items-center justify-center shrink-0 ${className}`}
    >
      <GraduationCap className={sizeCfg.icon} />
    </div>
  );
};
