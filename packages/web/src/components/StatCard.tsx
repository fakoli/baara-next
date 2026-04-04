import type { ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: number | string;
  icon: ReactNode;
  colorClass?: string;
}

export default function StatCard({ label, value, icon, colorClass = 'bg-white' }: StatCardProps) {
  return (
    <div className={`${colorClass} rounded-lg shadow-sm border border-gray-200 p-5 flex items-center gap-4`}>
      <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg bg-gray-50 text-gray-600">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-sm text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  );
}
