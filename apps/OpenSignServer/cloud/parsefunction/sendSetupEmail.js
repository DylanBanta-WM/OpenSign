export default async function sendSetupEmail(request) {
  if (!request.master) {
    throw new Parse.Error(Parse.Error.OPERATION_FORBIDDEN, 'Master key required.');
  }

  const email = request.params.email?.toLowerCase()?.trim();
  if (!email) {
    throw new Parse.Error(Parse.Error.INVALID_QUERY, 'Email is required.');
  }

  const userQuery = new Parse.Query(Parse.User);
  userQuery.equalTo('email', email);
  const user = await userQuery.first({ useMasterKey: true });

  if (!user) {
    throw new Parse.Error(Parse.Error.OBJECT_NOT_FOUND, 'User not found.');
  }

  user.set('isSetupEmail', true);
  await user.save(null, { useMasterKey: true });

  await Parse.User.requestPasswordReset(email);

  return { message: 'Setup email sent.' };
}
