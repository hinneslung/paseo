export function resolveRootRecoveryLocation(input: {
  generation: number;
  isVscodeRuntime: boolean;
}): string | undefined {
  if (input.generation === 0) return undefined;
  return input.isVscodeRuntime ? "/" : "/open-project";
}
