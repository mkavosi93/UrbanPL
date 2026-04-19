import React from 'react';
import { View, ActivityIndicator } from 'react-native';
import { Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import FeedScreen from '../screens/FeedScreen';
import CupsScreen from '../screens/CupsScreen';
import RankingsScreen from '../screens/RankingsScreen';
import ProfileScreen from '../screens/ProfileScreen';
import RefereeScreen from '../screens/RefereeScreen';
import AdminScreen from '../screens/AdminScreen';
import LoginScreen from '../screens/auth/LoginScreen';
import SignUpScreen from '../screens/auth/SignUpScreen';
import ResetPasswordScreen from '../screens/auth/ResetPasswordScreen';
import RefereeLoginScreen from '../screens/auth/RefereeLoginScreen';
import RefereeSignUpScreen from '../screens/auth/RefereeSignUpScreen';

import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { colors } from '../theme';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const TAB_ICONS = {
  Feed: '⚽',
  Cups: '🏆',
  Rankings: '📊',
  Profile: '👤',
  Referee: '🟨',
  Admin: '⚙️',
};

function MainTabs() {
  const { t } = useLanguage();
  const { player } = useAuth();
  const isRef = player?.is_referee || player?.is_admin;
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused }) => (
          <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>
            {TAB_ICONS[route.name]}
          </Text>
        ),
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.gray,
        tabBarStyle: {
          backgroundColor: colors.darkCard,
          borderTopColor: colors.darkBorder,
        },
        headerStyle: { backgroundColor: colors.dark },
        headerTitleStyle: { color: colors.gold, fontWeight: 'bold' },
        headerTintColor: colors.gold,
      })}
    >
      <Tab.Screen name="Feed" component={FeedScreen} options={{ headerTitle: 'Urban PL', tabBarLabel: t('nav.feed') }} />
      <Tab.Screen name="Cups" component={CupsScreen} options={{ tabBarLabel: t('nav.cups') }} />
      <Tab.Screen name="Rankings" component={RankingsScreen} options={{ tabBarLabel: t('nav.rankings') }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: t('nav.profile') }} />
      {isRef && (
        <Tab.Screen
          name="Referee"
          component={RefereeScreen}
          options={{
            tabBarLabel: 'Ref',
            headerTitle: '🟨 Referee Panel',
            tabBarIcon: ({ focused }) => (
              <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>🟨</Text>
            ),
          }}
        />
      )}
      {player?.is_admin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{
            tabBarLabel: 'Admin',
            headerTitle: '⚙️ Admin Panel',
            tabBarIcon: ({ focused }) => (
              <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>⚙️</Text>
            ),
          }}
        />
      )}
    </Tab.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
      <Stack.Screen name="RefereeLogin" component={RefereeLoginScreen} />
      <Stack.Screen name="RefereeSignUp" component={RefereeSignUpScreen} />
    </Stack.Navigator>
  );
}

export default function Navigation() {
  const { session, loading, isPasswordRecovery } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.dark, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isPasswordRecovery
        ? <ResetPasswordScreen />
        : session ? <MainTabs /> : <AuthStack />
      }
    </NavigationContainer>
  );
}
