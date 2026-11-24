import { useEffect, type ComponentType } from 'react';

export const withEda = <P extends Record<string, unknown>>(
  Component: ComponentType<P>,
  register: () => () => void,
  onMount?: () => void,
) => {
  const WithEda = (props: P) => {
    useEffect(() => {
      const unsubscribe = register();
      onMount?.();
      return unsubscribe;
    }, []);
    return <Component {...props} />;
  };

  return WithEda;
};
