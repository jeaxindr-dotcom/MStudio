import React from 'react';
import {Composition} from 'remotion';
import {compositions} from './coulisses';

export const Root = () => <Composition {...compositions[0]}/>;
