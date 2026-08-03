export function createContextMenuLifecycle(dependencies: any) {
  let loaded: Promise<Record<string, any>> | undefined;
  const load = () => loaded ||= import("./context-menus").then(
    (module) => module.createContextMenuLifecycle(dependencies) as Record<string, any>,
  );
  const call = (name: string, args: any[]) =>
    load().then((lifecycle) => lifecycle[name](...args));
  return {
    register: (...args: any[]) => call("register", args),
    refresh: (...args: any[]) => call("refresh", args),
    handleSave: (...args: any[]) => call("handleSave", args),
    handleUpdateSnapshot: (...args: any[]) => call("handleUpdateSnapshot", args),
    handleImageCover: (...args: any[]) => call("handleImageCover", args),
  };
}
