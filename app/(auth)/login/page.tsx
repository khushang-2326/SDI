import { loginAction } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-cyan-950 p-6"><form action={loginAction} className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"><h1 className="text-3xl font-bold">Admin login</h1>{error ? <p className="mt-4 text-red-700">{error}</p> : null}<label className="mt-6 block">Login ID<input className="mt-2 w-full rounded-xl border p-3" name="loginId" required /></label><label className="mt-4 block">Password<input className="mt-2 w-full rounded-xl border p-3" name="password" required type="password" /></label><button className="mt-6 w-full rounded-xl bg-brand p-3 font-semibold text-white">Sign in</button><p className="mt-4 text-xs text-muted">ID: admin · Password: admin123</p></form></main>;
}
