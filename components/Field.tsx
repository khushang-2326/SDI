type BaseProps = {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
};

type FieldProps = BaseProps & {
  type?: "text" | "email" | "password" | "tel" | "url";
};

export function Field({
  label,
  name,
  defaultValue,
  required = true,
  placeholder,
  type = "text"
}: FieldProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <input
        className="mt-2 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
        type={type}
      />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  required = true,
  placeholder
}: BaseProps) {
  return (
    <label className="block">
      <span className="text-sm font-medium text-ink">{label}</span>
      <textarea
        className="mt-2 min-h-28 w-full rounded-md border border-line bg-white px-3 py-2 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20"
        defaultValue={defaultValue}
        name={name}
        placeholder={placeholder}
        required={required}
      />
    </label>
  );
}
