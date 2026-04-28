export const CardInfo = ({ title, description }: { title: string; description: string }) => (
  <div className="flex items-center gap-1 cursor-help" title={description}>
    <span>{title}</span>
    <i className="fas fa-info-circle text-slate-400 text-xs hover:text-slate-600" title={description}></i>
  </div>
);
