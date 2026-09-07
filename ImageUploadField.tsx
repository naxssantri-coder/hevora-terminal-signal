import React, { useState, useRef } from 'react';
import { Upload, Image as ImageIcon, X, RefreshCw, AlertCircle } from 'lucide-react';

export async function uploadImageToCloudinary(file: File): Promise<string> {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'mzpsieps';
  const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET || 'hevterminal_upload';

  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', uploadPreset);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw new Error('Upload gambar gagal. Coba lagi.');
  }

  const data = await res.json();
  return data.secure_url as string;
}

/**
 * Adds dark gradient and "HEVORA" logo overlay at the bottom of the image using HTML5 Canvas API
 */
async function addHevoraOverlay(file: File): Promise<File> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Gradient overlay at bottom 35%
      const overlayHeight = img.height * 0.35;
      const gradient = ctx.createLinearGradient(0, img.height - overlayHeight, 0, img.height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.75)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, img.height - overlayHeight, img.width, overlayHeight);

      // Draw bold "HEVORA" text at bottom-left
      const fontSize = Math.max(16, Math.round(img.width * 0.045));
      ctx.font = `bold ${fontSize}px sans-serif, monospace`;
      ctx.fillStyle = '#F5B942';
      ctx.textBaseline = 'bottom';
      const marginX = img.width * 0.04;
      const marginY = img.height * 0.04;
      ctx.fillText('HEVORA', marginX, img.height - marginY);

      canvas.toBlob(
        (blob) => {
          if (blob) {
            const newFile = new File(
              [blob],
              file.name.replace(/\.[^/.]+$/, '') + '_hevora.jpg',
              { type: 'image/jpeg' }
            );
            resolve(newFile);
          } else {
            resolve(file);
          }
        },
        'image/jpeg',
        0.9
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

interface ImageUploadFieldProps {
  label: string;
  value?: string;
  onChange: (url: string) => void;
  accentColor?: string;
}

export const ImageUploadField: React.FC<ImageUploadFieldProps> = ({
  label,
  value,
  onChange,
  accentColor = 'var(--accent-gold)',
}) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [addOverlay, setAddOverlay] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('File harus berupa gambar (JPG, PNG, WEBP, dll).');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Ukuran gambar maksimal 5MB.');
      return;
    }

    setError('');
    setUploading(true);

    try {
      const fileToUpload = addOverlay ? await addHevoraOverlay(file) : file;
      const url = await uploadImageToCloudinary(fileToUpload);
      onChange(url);
    } catch (err) {
      setError('Upload gambar gagal. Coba lagi.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
    if (e.target) {
      e.target.value = '';
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div className="space-y-1.5 font-mono">
      <label className="block text-xs font-medium text-[var(--text-secondary)]">{label}</label>

      {/* Hidden File Input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />

      {/* Preview Box if value exists */}
      {value ? (
        <div className="relative group rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-panel)] overflow-hidden">
          <img
            src={value}
            alt="Preview"
            className="w-full h-36 object-cover object-center transition-all group-hover:opacity-85"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
          <div className="p-2 bg-[var(--bg-surface)] border-t border-[var(--border-subtle)] flex items-center justify-between gap-2">
            <span className="text-[10px] text-[var(--text-muted)] truncate max-w-[200px]" title={value}>
              {value}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="px-2.5 py-1 bg-[var(--bg-surface)] hover:bg-[var(--card-hover-bg)] border border-[var(--border-subtle)] text-[10px] font-bold text-[var(--text-primary)] rounded cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
              >
                {uploading ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    <span>Mengupload...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-3 h-3" />
                    <span>Ganti Gambar</span>
                  </>
                )}
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => onChange('')}
                className="p-1 bg-[var(--bg-surface)] hover:bg-[#FF4D4F]/20 border border-[var(--border-subtle)] text-[#FF4D4F] rounded cursor-pointer transition-all"
                title="Hapus Gambar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Upload Drag-and-Drop Area */
        <div className="space-y-2">
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !uploading && inputRef.current?.click()}
            className={`p-4 rounded-lg border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center text-center ${
              isDragging
                ? 'border-[var(--accent-gold)] bg-[var(--accent-gold)]/5'
                : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)] bg-[var(--bg-surface)]'
            } ${uploading ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <RefreshCw className="w-5 h-5 text-[var(--accent-gold)] animate-spin" />
                <span className="text-xs text-[var(--text-primary)] font-bold">Mengupload gambar ke Cloudinary...</span>
                <span className="text-[10px] text-[var(--text-muted)]">Mohon tunggu sebentar</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1.5 py-1">
                <div className="w-8 h-8 rounded-full bg-[var(--bg-panel)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--text-muted)]">
                  <ImageIcon className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-[var(--text-primary)]">
                  <span style={{ color: accentColor }}>Klik untuk upload</span> atau drag & drop file
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">Format: PNG, JPG, WEBP (Maksimal 5MB)</span>
              </div>
            )}
          </div>

          {/* Ratio recommendation hint */}
          <span className="text-[10px] text-[var(--text-muted)] block">
            Rasio ideal: 4:5 (contoh: 1080 x 1350 px), seperti postingan Instagram.
          </span>

          {/* Automatic HEVORA Overlay Checkbox */}
          <label className="flex items-center gap-2 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={addOverlay}
              onChange={(e) => setAddOverlay(e.target.checked)}
              className="rounded accent-[var(--accent-gold)] cursor-pointer"
            />
            <span>Tambahkan overlay HEVORA otomatis</span>
          </label>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="flex items-center gap-1.5 text-[10px] text-[#FF4D4F] mt-1 bg-[#FF4D4F]/10 p-1.5 rounded border border-[#FF4D4F]/20">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
