import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Image } from 'react-native';
import { colors } from '../theme';

export default function SplashScreen({ onDone }) {
  const scale   = useRef(new Animated.Value(0.75)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const plScale = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.sequence([
      // Fade + scale in
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.spring(plScale, { toValue: 1, tension: 40, friction: 6, delay: 120, useNativeDriver: true }),
      ]),
      // Hold
      Animated.delay(900),
      // Fade out
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone?.());
  }, []);

  return (
    <View style={styles.container}>
      {/* Background glow */}
      <View style={styles.glow} />

      <Animated.View style={[styles.content, { opacity, transform: [{ scale }] }]}>
        {/* Logo mark */}
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logoMark}
          resizeMode="contain"
        />

        {/* Wordmark */}
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkUrban}>URBAN</Text>
          <Animated.Text style={[styles.wordmarkPL, { transform: [{ scale: plScale }] }]}>
            PL
          </Animated.Text>
        </View>

        <Text style={styles.tagline}>PICKUP LEAGUE</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(232, 184, 75, 0.06)',
  },
  content: {
    alignItems: 'center',
  },
  logoMark: {
    width: 120,
    height: 120,
    marginBottom: 20,
  },
  wordmark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    marginBottom: 12,
  },
  wordmarkUrban: {
    fontSize: 42,
    fontWeight: '300',
    color: colors.white,
    letterSpacing: 6,
  },
  wordmarkPL: {
    fontSize: 52,
    fontWeight: '900',
    color: colors.gold,
    letterSpacing: -1,
    lineHeight: 52,
  },
  tagline: {
    color: colors.gray,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 4,
  },
});
