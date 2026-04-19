import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Alert, Image,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { colors, spacing, radius } from '../../theme';

export default function ResetPasswordScreen() {
  const { setIsPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleReset() {
    if (password.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      Alert.alert('Mismatch', 'Passwords do not match.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      Alert.alert('Password updated!', 'You can now sign in with your new password.', [
        { text: 'OK', onPress: () => setIsPasswordRecovery(false) },
      ]);
    }
  }

  return (
    <View style={styles.container}>
      <Image
        source={require('../../../assets/logo.png')}
        style={styles.logo}
        resizeMode="contain"
      />
      <Text style={styles.title}>Set New Password</Text>
      <Text style={styles.subtitle}>Choose a strong password for your account</Text>

      <Text style={styles.label}>New Password</Text>
      <View style={styles.passwordRow}>
        <TextInput
          style={[styles.input, styles.passwordInput]}
          placeholder="At least 8 characters"
          placeholderTextColor={colors.gray}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
        />
        <TouchableOpacity style={styles.eyeBtn} onPress={() => setShowPassword(!showPassword)}>
          <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.label}>Confirm Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Repeat new password"
        placeholderTextColor={colors.gray}
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry={!showPassword}
      />

      <TouchableOpacity
        style={[styles.btn, loading && styles.btnDisabled]}
        onPress={handleReset}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color={colors.dark} />
          : <Text style={styles.btnText}>Update Password</Text>
        }
      </TouchableOpacity>

      <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsPasswordRecovery(false)}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.dark,
    padding: spacing.lg,
    justifyContent: 'center',
  },
  logo: { width: 80, height: 80, alignSelf: 'center', marginBottom: spacing.xl },
  title: { fontSize: 26, fontWeight: 'bold', color: colors.white, marginBottom: spacing.xs },
  subtitle: { fontSize: 14, color: colors.gray, marginBottom: spacing.xl },
  label: { color: colors.grayLight, fontSize: 13, marginBottom: spacing.xs, marginTop: spacing.md },
  input: {
    backgroundColor: colors.darkCard,
    borderWidth: 1,
    borderColor: colors.darkBorder,
    borderRadius: radius.md,
    color: colors.white,
    padding: spacing.md,
    fontSize: 16,
  },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 50 },
  eyeBtn: { position: 'absolute', right: spacing.md, top: spacing.md },
  eyeIcon: { fontSize: 18 },
  btn: {
    backgroundColor: colors.gold,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: colors.dark, fontWeight: 'bold', fontSize: 16 },
  cancelBtn: { alignItems: 'center', marginTop: spacing.md },
  cancelText: { color: colors.gray, fontSize: 14 },
});
