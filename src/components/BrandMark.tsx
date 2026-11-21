import {useState} from 'react';
import {ShieldCheck} from 'lucide-react';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
}

export function BrandMark({size = 'md'}: BrandMarkProps) {
  const [imgError, setImgError] = useState(false);

  const dims =
    size === 'lg'
      ? 'w-24 h-24 rounded-3xl'
      : size === 'sm'
        ? 'w-9 h-9 rounded-xl'
        : 'w-11 h-11 rounded-2xl';

  if (imgError) {
    return (
      <div
        className={`${dims} bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-sm shrink-0`}
        aria-hidden="true"
      >
        <ShieldCheck className={size === 'lg' ? 'w-12 h-12' : 'w-5 h-5'} />
      </div>
    );
  }

  return (
    <img
      src="/assets/aistudio/file_000000004c7c8206b8e618ba89eec244_ef40b7a1.png"
      alt="Biểu tượng SafeMess"
      referrerPolicy="no-referrer"
      onError={() => setImgError(true)}
      className={`${dims} object-cover shrink-0 bg-white`}
    />
  );
}
