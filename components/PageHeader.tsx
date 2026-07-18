export function PageHeader({
  title,
  description
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-5 sm:mb-7">
      <div className="mb-3 h-1 w-12 rounded-full bg-gradient-to-r from-brand to-cyan-400" />
      <h1 className="bg-gradient-to-r from-slate-900 via-indigo-900 to-brand bg-clip-text text-2xl font-bold tracking-tight text-transparent sm:text-3xl md:text-4xl">
        {title}
      </h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{description}</p>
    </div>
  );
}
